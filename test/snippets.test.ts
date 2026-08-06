import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SchemaStore } from '../src/schemaStore';
import { KqlSyntaxChecker } from '../src/syntaxChecker';

const repoRoot = path.join(__dirname, '..', '..');
const bundledSchemaPath = path.join(repoRoot, 'schemas', 'all-tables.json');
const snippetsPath = path.join(repoRoot, 'snippets', 'kql.json');

/** Placeholder table names used in generic snippets — not real schema tables */
const PLACEHOLDER_TABLES = new Set([
    'TableName',
    'LeftTable',
    'RightTable',
    'SourceTable',
    'Table1',
    'Table2',
]);

interface Snippet {
    prefix?: string;
    body: string[];
    description?: string;
}

function loadSnippets(): Record<string, Snippet> {
    return JSON.parse(fs.readFileSync(snippetsPath, 'utf8')) as Record<string, Snippet>;
}

/** Concrete PascalCase table names referenced as query sources in snippet bodies */
function extractConcreteTables(body: string[]): string[] {
    const tables = new Set<string>();
    const text = body.join('\n');

    for (const line of text.split('\n')) {
        const source = line.match(/^(?:let\s+[A-Za-z_]\w*\s*=\s*)?([A-Z][A-Za-z0-9]*)\b/);
        if (!source) {
            continue;
        }
        const name = source[1];
        if (PLACEHOLDER_TABLES.has(name) || name.includes('${')) {
            continue;
        }
        tables.add(name);
    }

    return [...tables];
}

describe('Snippets', () => {
    const snippets = loadSnippets();
    const store = new SchemaStore(bundledSchemaPath);

    it('references only tables that exist in the bundled schema', () => {
        const missing: string[] = [];

        for (const [name, snippet] of Object.entries(snippets)) {
            for (const table of extractConcreteTables(snippet.body)) {
                if (!store.validateTableExists(table)) {
                    missing.push(`${name}: ${table}`);
                }
            }
        }

        assert.deepStrictEqual(missing, [], `Unknown tables in snippets:\n${missing.join('\n')}`);
    });

    it('security starter snippets have no unknown-table diagnostics', () => {
        const checker = new KqlSyntaxChecker();
        checker.setSchemaValidator({
            validateTableExists: (t) => store.validateTableExists(t),
            validateColumn: (t, c) => store.validateColumn(t, c),
            suggestSimilarTable: (t) => store.suggestSimilarTable(t),
            getCanonicalTableName: (t) => store.getCanonicalTableName(t),
            getColumns: (t) => store.getColumns(t),
        });

        const securityPrefixes = new Set([
            'failedlogins',
            'suspiciouslogin',
            'emailsecurity',
            'signinanalysis',
            'securityalerts',
            'mdeprocess',
            'mdenetwork',
            'asimnet',
            'watchlistjoin',
            'timatch',
            'syslogauth',
        ]);

        const failures: string[] = [];

        for (const [name, snippet] of Object.entries(snippets)) {
            if (!snippet.prefix || !securityPrefixes.has(snippet.prefix)) {
                continue;
            }

            const query = snippet.body
                .filter(line => line !== '$0')
                .join('\n')
                // Snippet placeholders -> harmless literals for validation
                .replace(/\$\{\d+:([^}]+)\}/g, '$1')
                .replace(/\$\d+/g, '')
                .replace(/\$\{[^}]+\}/g, 'value');

            // Column-scope after join+project is still partial in QueryModel; enforce table fidelity here.
            const unknownTables = checker
                .check(query)
                .filter(e => e.message.startsWith('Unknown table'));
            if (unknownTables.length > 0) {
                failures.push(
                    `${name} (${snippet.prefix}):\n` +
                    unknownTables.map(e => `  L${e.line}: ${e.message}`).join('\n')
                );
            }
        }

        assert.deepStrictEqual(failures, [], `Snippet validation failed:\n${failures.join('\n\n')}`);
    });

    it('includes SecurityAlert and Syslog in the bundled schema', () => {
        assert.ok(store.validateTableExists('SecurityAlert'));
        assert.ok(store.validateColumn('SecurityAlert', 'AlertSeverity'));
        assert.ok(store.validateColumn('SecurityAlert', 'Tactics'));
        assert.ok(store.validateTableExists('Syslog'));
        assert.ok(store.validateColumn('Syslog', 'SyslogMessage'));
    });
});
