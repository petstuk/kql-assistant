#!/usr/bin/env node
/**
 * Headless KQL Assistant CLI for detection-as-code CI.
 *
 * Usage:
 *   node out/src/cli.js lint [paths...] [--format text|sarif] [--lint basic|strict|off]
 *   npx kql-assistant lint path/to/queries
 */
import * as fs from 'fs';
import * as path from 'path';
import { SchemaStore } from './schemaStore';
import { KqlSyntaxChecker, SyntaxError } from './syntaxChecker';
import { LintMode } from './lintRules';

interface CliOptions {
    paths: string[];
    format: 'text' | 'sarif';
    lintMode: LintMode;
    schemaPacks: string[];
    userSchemaPath?: string;
    failOn: 'error' | 'warning' | 'information';
}

interface FileResult {
    file: string;
    issues: SyntaxError[];
}

function repoSchemasDir(): string {
    // Prefer compiled layout: out/src/cli.js -> ../../schemas
    const fromOut = path.resolve(__dirname, '..', '..', 'schemas');
    if (fs.existsSync(path.join(fromOut, 'all-tables.json'))) {
        return fromOut;
    }
    // ts-node / src layout
    const fromSrc = path.resolve(__dirname, '..', 'schemas');
    if (fs.existsSync(path.join(fromSrc, 'all-tables.json'))) {
        return fromSrc;
    }
    return fromOut;
}

function parseArgs(argv: string[]): { command: string; options: CliOptions } {
    const args = argv.slice(2);
    const command = args[0] && !args[0].startsWith('-') ? args[0] : 'lint';
    const rest = command === args[0] ? args.slice(1) : args;

    const options: CliOptions = {
        paths: [],
        format: 'text',
        lintMode: 'basic',
        schemaPacks: ['all'],
        failOn: 'error'
    };

    for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === '--format') {
            const value = rest[++i];
            if (value === 'sarif' || value === 'text') {
                options.format = value;
            }
        } else if (arg === '--lint') {
            const value = rest[++i];
            if (value === 'off' || value === 'basic' || value === 'strict') {
                options.lintMode = value;
            }
        } else if (arg === '--packs') {
            options.schemaPacks = (rest[++i] ?? 'all').split(',').map(s => s.trim()).filter(Boolean);
        } else if (arg === '--user-schema') {
            options.userSchemaPath = rest[++i];
        } else if (arg === '--fail-on') {
            const value = rest[++i];
            if (value === 'error' || value === 'warning' || value === 'information') {
                options.failOn = value;
            }
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (!arg.startsWith('-')) {
            options.paths.push(arg);
        }
    }

    if (options.paths.length === 0) {
        options.paths.push('.');
    }

    return { command, options };
}

function printHelp(): void {
    console.log(`KQL Assistant CLI

Usage:
  kql-assistant lint [paths...] [options]

Options:
  --format text|sarif     Output format (default: text)
  --lint off|basic|strict Detection/cost lint pack (default: basic)
  --packs a,b,c           Schema packs (default: all)
  --user-schema <path>    Merge custom schema JSON
  --fail-on error|warning|information
                          Exit 1 threshold (default: error)
  -h, --help              Show help
`);
}

function collectKqlFiles(inputs: string[]): string[] {
    const files = new Set<string>();

    const walk = (target: string): void => {
        if (!fs.existsSync(target)) {
            return;
        }
        const stat = fs.statSync(target);
        if (stat.isFile()) {
            if (/\.(kql|kusto)$/i.test(target)) {
                files.add(path.resolve(target));
            }
            return;
        }
        if (!stat.isDirectory()) {
            return;
        }
        for (const entry of fs.readdirSync(target)) {
            if (entry === 'node_modules' || entry === '.git' || entry === 'out') {
                continue;
            }
            walk(path.join(target, entry));
        }
    };

    for (const input of inputs) {
        // Minimal glob: support trailing **/*.kql style by walking dirname
        if (input.includes('*')) {
            const base = input.split('*')[0] || '.';
            walk(base);
            continue;
        }
        walk(input);
    }

    return [...files].sort();
}

function createChecker(options: CliOptions): KqlSyntaxChecker {
    const schemasDir = repoSchemasDir();
    const store = new SchemaStore(
        path.join(schemasDir, 'all-tables.json'),
        options.userSchemaPath,
        {
            schemaPacks: options.schemaPacks,
            packsDir: path.join(schemasDir, 'packs')
        }
    );

    const checker = new KqlSyntaxChecker();
    checker.setSchemaValidator({
        validateTableExists: t => store.validateTableExists(t),
        validateColumn: (t, c) => store.validateColumn(t, c),
        suggestSimilarTable: t => store.suggestSimilarTable(t),
        getCanonicalTableName: t => store.getCanonicalTableName(t),
        getColumns: t => store.getColumns(t)
    });
    checker.setLintMode(options.lintMode);
    return checker;
}

function lintFiles(options: CliOptions): FileResult[] {
    const checker = createChecker(options);
    const files = collectKqlFiles(options.paths);
    const results: FileResult[] = [];

    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        results.push({ file, issues: checker.check(text) });
    }

    return results;
}

function severityRank(severity: string | undefined): number {
    switch (severity) {
        case 'information':
            return 1;
        case 'warning':
            return 2;
        default:
            return 3; // error
    }
}

function shouldFail(results: FileResult[], failOn: CliOptions['failOn']): boolean {
    const threshold = severityRank(failOn === 'information' ? 'information' : failOn);
    return results.some(r =>
        r.issues.some(issue => severityRank(issue.severity ?? 'error') >= threshold)
    );
}

function printText(results: FileResult[]): void {
    let total = 0;
    for (const result of results) {
        if (result.issues.length === 0) {
            continue;
        }
        for (const issue of result.issues) {
            total++;
            const sev = (issue.severity ?? 'error').toUpperCase();
            const code = issue.code ? `${issue.code} ` : '';
            console.log(
                `${result.file}:${issue.line + 1}:${issue.column + 1}: ${sev} ${code}${issue.message}`
            );
        }
    }
    const fileCount = results.length;
    console.log(
        `\n${total} issue(s) in ${fileCount} file(s)`
    );
}

function printSarif(results: FileResult[]): void {
    const rules = new Map<string, string>();
    for (const result of results) {
        for (const issue of result.issues) {
            const id = issue.code ?? 'KQL000';
            if (!rules.has(id)) {
                rules.set(id, issue.message);
            }
        }
    }

    const sarif = {
        version: '2.1.0',
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        runs: [
            {
                tool: {
                    driver: {
                        name: 'kql-assistant',
                        informationUri: 'https://github.com/petstuk/kql-assistant',
                        rules: [...rules.entries()].map(([id, name]) => ({
                            id,
                            name,
                            shortDescription: { text: name }
                        }))
                    }
                },
                results: results.flatMap(result =>
                    result.issues.map(issue => ({
                        ruleId: issue.code ?? 'KQL000',
                        level:
                            issue.severity === 'information'
                                ? 'note'
                                : issue.severity === 'warning'
                                  ? 'warning'
                                  : 'error',
                        message: { text: issue.message },
                        locations: [
                            {
                                physicalLocation: {
                                    artifactLocation: {
                                        uri: path.relative(process.cwd(), result.file).replace(/\\/g, '/')
                                    },
                                    region: {
                                        startLine: issue.line + 1,
                                        startColumn: issue.column + 1
                                    }
                                }
                            }
                        ]
                    }))
                )
            }
        ]
    };

    console.log(JSON.stringify(sarif, null, 2));
}

function main(): void {
    const { command, options } = parseArgs(process.argv);
    if (command !== 'lint') {
        console.error(`Unknown command '${command}'. Try: kql-assistant lint`);
        printHelp();
        process.exit(2);
    }

    const results = lintFiles(options);
    if (options.format === 'sarif') {
        printSarif(results);
    } else {
        printText(results);
    }

    process.exit(shouldFail(results, options.failOn) ? 1 : 0);
}

main();
