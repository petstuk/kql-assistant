#!/usr/bin/env node
/**
 * Headless KQL Assistant CLI for detection-as-code CI.
 *
 * Usage:
 *   node out/src/cli.js lint [paths...] [--format text|sarif] [--lint basic|strict|off]
 *   node out/src/cli.js schema convert tables.json -o workspace-schema.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { SchemaStore } from './schemaStore';
import { KqlSyntaxChecker, SyntaxError } from './syntaxChecker';
import { LintMode } from './lintRules';
import { extractYamlQueryBlocks, remapYamlQueryIssues } from './sentinelYaml';
import { hasGlobChars, matchPathGlob } from './pathGlob';
import {
    applySeverityOverrides,
    isIgnoredPath,
    loadLintConfig,
    loadLintConfigFile,
    LintConfigFile,
    SeverityName
} from './lintConfig';
import { convertToUserSchema } from './schemaConvert';

interface CliOptions {
    paths: string[];
    format: 'text' | 'sarif';
    lintMode: LintMode;
    schemaPacks: string[];
    userSchemaPath?: string;
    failOn: 'error' | 'warning' | 'information';
    ignorePatterns: string[];
    severity?: Record<string, SeverityName>;
    configPath?: string;
    lintModeSet: boolean;
    packsSet: boolean;
    failOnSet: boolean;
    userSchemaSet: boolean;
}

interface FileResult {
    file: string;
    issues: SyntaxError[];
}

const LINT_EXT = /\.(kql|kusto|csl|ya?ml)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'out']);

function repoSchemasDir(): string {
    const fromOut = path.resolve(__dirname, '..', '..', 'schemas');
    if (fs.existsSync(path.join(fromOut, 'all-tables.json'))) {
        return fromOut;
    }
    const fromSrc = path.resolve(__dirname, '..', 'schemas');
    if (fs.existsSync(path.join(fromSrc, 'all-tables.json'))) {
        return fromSrc;
    }
    return fromOut;
}

function parseLintArgs(rest: string[]): CliOptions {
    const options: CliOptions = {
        paths: [],
        format: 'text',
        lintMode: 'basic',
        schemaPacks: ['all'],
        failOn: 'error',
        ignorePatterns: [],
        lintModeSet: false,
        packsSet: false,
        failOnSet: false,
        userSchemaSet: false
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
                options.lintModeSet = true;
            }
        } else if (arg === '--packs') {
            options.schemaPacks = (rest[++i] ?? 'all').split(',').map(s => s.trim()).filter(Boolean);
            options.packsSet = true;
        } else if (arg === '--user-schema') {
            options.userSchemaPath = rest[++i];
            options.userSchemaSet = true;
        } else if (arg === '--fail-on') {
            const value = rest[++i];
            if (value === 'error' || value === 'warning' || value === 'information') {
                options.failOn = value;
                options.failOnSet = true;
            }
        } else if (arg === '--ignore-pattern') {
            const value = rest[++i];
            if (value) {
                options.ignorePatterns.push(value);
            }
        } else if (arg === '--config') {
            options.configPath = rest[++i];
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

    return options;
}

function applyConfigFile(options: CliOptions, cwd: string): CliOptions {
    let file: LintConfigFile = {};
    if (options.configPath) {
        file = loadLintConfigFile(path.resolve(cwd, options.configPath));
    } else {
        file = loadLintConfig(cwd).config;
    }

    if (!options.lintModeSet && file.lint) {
        options.lintMode = file.lint;
    }
    if (!options.packsSet && file.packs && file.packs.length > 0) {
        options.schemaPacks = file.packs;
    }
    if (!options.userSchemaSet && file.userSchemaPath) {
        options.userSchemaPath = path.resolve(cwd, file.userSchemaPath);
    }
    if (!options.failOnSet && file.failOn) {
        options.failOn = file.failOn;
    }
    options.ignorePatterns = [...(file.ignorePatterns ?? []), ...options.ignorePatterns];
    options.severity = file.severity;
    return options;
}

function printHelp(): void {
    console.log(`KQL Assistant CLI

Usage:
  kql-assistant lint [paths...] [options]
  kql-assistant schema convert <input.json> [-o schema.json] [--table Name]

Lints .kql / .kusto / .csl files and Sentinel YAML (query: | blocks).
Paths may be files, directories, or globs (e.g. detections/**/*.kql).

Options:
  --format text|sarif     Output format (default: text)
  --lint off|basic|strict Detection/cost lint pack (default: basic)
  --packs a,b,c           Schema packs (default: all)
  --user-schema <path>    Merge custom schema JSON
  --fail-on error|warning|information
                          Exit 1 threshold (default: error)
  --ignore-pattern <glob> Skip matching files (repeatable)
  --config <path>         kql-assistant.json (default: walk up from cwd)
  -h, --help              Show help

Repo config (kql-assistant.json):
  lint, packs, userSchemaPath, failOn, ignorePatterns, severity
`);
}

function globWalkRoot(pattern: string, cwd: string): string {
    const normalized = pattern.replace(/\\/g, '/');
    const star = normalized.search(/[*?[{]/);
    const prefix = star === -1 ? normalized : normalized.slice(0, star);
    const lastSlash = prefix.lastIndexOf('/');
    if (lastSlash === -1) {
        return cwd;
    }
    return path.resolve(cwd, prefix.slice(0, lastSlash));
}

function walkFiles(root: string, files: string[]): void {
    if (!fs.existsSync(root)) {
        return;
    }
    const stat = fs.statSync(root);
    if (stat.isFile()) {
        files.push(root);
        return;
    }
    if (!stat.isDirectory()) {
        return;
    }
    for (const entry of fs.readdirSync(root)) {
        if (SKIP_DIRS.has(entry)) {
            continue;
        }
        walkFiles(path.join(root, entry), files);
    }
}

export function collectKqlFiles(
    inputs: string[],
    cwd: string = process.cwd(),
    ignorePatterns: string[] = []
): string[] {
    const files = new Set<string>();

    const consider = (abs: string): void => {
        if (!LINT_EXT.test(abs)) {
            return;
        }
        if (isIgnoredPath(abs, cwd, ignorePatterns)) {
            return;
        }
        files.add(path.resolve(abs));
    };

    for (const input of inputs) {
        if (hasGlobChars(input)) {
            const walked: string[] = [];
            walkFiles(globWalkRoot(input, cwd), walked);
            for (const abs of walked) {
                const relative = path.relative(cwd, abs).replace(/\\/g, '/');
                if (matchPathGlob(relative, input) || matchPathGlob(abs, input)) {
                    consider(abs);
                }
            }
            continue;
        }

        const target = path.resolve(cwd, input);
        if (!fs.existsSync(target)) {
            continue;
        }
        const stat = fs.statSync(target);
        if (stat.isFile()) {
            consider(target);
            continue;
        }
        const walked: string[] = [];
        walkFiles(target, walked);
        for (const abs of walked) {
            consider(abs);
        }
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

function lintFiles(options: CliOptions, cwd: string): FileResult[] {
    const checker = createChecker(options);
    const files = collectKqlFiles(options.paths, cwd, options.ignorePatterns);
    const results: FileResult[] = [];

    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        let issues: SyntaxError[];
        if (/\.ya?ml$/i.test(file)) {
            const blocks = extractYamlQueryBlocks(text);
            if (blocks.length === 0) {
                continue;
            }
            issues = blocks.flatMap(block =>
                remapYamlQueryIssues(block, checker.check(block.text))
            );
        } else {
            issues = checker.check(text);
        }
        results.push({
            file,
            issues: applySeverityOverrides(issues, options.severity)
        });
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
            return 3;
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
    console.log(`\n${total} issue(s) in ${results.length} file(s)`);
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

function runSchemaConvert(args: string[]): void {
    let input: string | undefined;
    let output: string | undefined;
    let tableName: string | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-o' || arg === '--output') {
            output = args[++i];
        } else if (arg === '--table') {
            tableName = args[++i];
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (arg !== 'convert' && !arg.startsWith('-')) {
            input = arg;
        }
    }

    if (!input) {
        console.error('schema convert requires an input JSON file');
        process.exit(2);
    }

    const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
    const schema = convertToUserSchema(raw, { tableName });
    const json = JSON.stringify(schema, null, 2) + '\n';
    if (output) {
        fs.writeFileSync(output, json);
        console.error(`Wrote ${Object.keys(schema).length} table(s) to ${output}`);
    } else {
        process.stdout.write(json);
    }
}

function main(): void {
    const argv = process.argv.slice(2);
    const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'lint';
    const rest = command === argv[0] ? argv.slice(1) : argv;

    if (command === 'schema') {
        runSchemaConvert(rest);
        return;
    }

    if (command !== 'lint') {
        console.error(`Unknown command '${command}'. Try: kql-assistant lint`);
        printHelp();
        process.exit(2);
    }

    const cwd = process.cwd();
    const options = applyConfigFile(parseLintArgs(rest), cwd);
    const results = lintFiles(options, cwd);
    if (options.format === 'sarif') {
        printSarif(results);
    } else {
        printText(results);
    }

    process.exit(shouldFail(results, options.failOn) ? 1 : 0);
}

if (require.main === module) {
    main();
}
