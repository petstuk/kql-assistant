import * as assert from 'assert';
import * as path from 'path';
import { buildQueryModel, getScopeAtLine } from '../src/queryModel';
import { SchemaStore } from '../src/schemaStore';

const repoRoot = path.join(__dirname, '..', '..');
const bundledSchemaPath = path.join(repoRoot, 'schemas', 'all-tables.json');
const userSchemaPath = path.join(repoRoot, 'test', 'fixtures', 'user-schema.json');

const schema = new SchemaStore(bundledSchemaPath, userSchemaPath);

describe('QueryModel', () => {
    it('splits multiple query blocks on markdown headers', () => {
        const model = buildQueryModel(
            '# Identity #\nSigninLogs\n| take 10\n\n# Alerts #\nCustomAlerts\n| take 5',
            schema
        );

        assert.strictEqual(model.blocks.length, 2);
        assert.strictEqual(model.blocks[0].sourceTable, 'SigninLogs');
        assert.strictEqual(model.blocks[1].sourceTable, 'CustomAlerts');
    });

    it('tracks project aliases as output columns', () => {
        const model = buildQueryModel(
            'SigninLogs\n| project OfficeTime = TimeGenerated, UserPrincipalName',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.deepStrictEqual(step.definedColumns.map(column => column.name), ['OfficeTime']);
        assert.ok(step.outputColumns.includes('OfficeTime'));
        assert.ok(step.outputColumns.includes('UserPrincipalName'));
    });

    it('tracks extend aliases without dropping input columns', () => {
        const model = buildQueryModel(
            'SigninLogs\n| extend UserLower = tolower(UserPrincipalName)',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.ok(step.outputColumns.includes('UserPrincipalName'));
        assert.ok(step.outputColumns.includes('UserLower'));
        assert.ok(step.referencedColumns.some(column => column.name === 'UserPrincipalName'));
    });

    it('tracks summarize output scope', () => {
        const model = buildQueryModel(
            'SigninLogs\n| summarize Total = count() by UserPrincipalName',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.deepStrictEqual(step.outputColumns.sort(), ['Total', 'UserPrincipalName'].sort());
    });

    it('tracks project-away removed columns', () => {
        const model = buildQueryModel(
            'SigninLogs\n| project-away UserPrincipalName',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.ok(step.removedColumns.some(column => column.name === 'UserPrincipalName'));
        assert.ok(!step.outputColumns.includes('UserPrincipalName'));
    });

    it('tracks simple mv-expand references and aliases', () => {
        const model = buildQueryModel(
            'SigninLogs\n| mv-expand ExpandedUser = UserPrincipalName',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.ok(step.definedColumns.some(column => column.name === 'ExpandedUser'));
        assert.ok(step.referencedColumns.some(column => column.name === 'UserPrincipalName'));
        assert.ok(step.outputColumns.includes('ExpandedUser'));
    });

    it('tracks single-line join table and keys', () => {
        const model = buildQueryModel(
            'SigninLogs\n| join kind=inner (AuditLogs) on Id == Id',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.strictEqual(step.join?.rightTable, 'AuditLogs');
        assert.deepStrictEqual(step.join?.keys.map(key => key.name), ['Id', 'Id']);
        assert.ok(step.outputTables.includes('AuditLogs'));
    });

    it('tracks multiline join table and keys', () => {
        const model = buildQueryModel(
            'SigninLogs\n| join kind=inner (\n    AuditLogs\n) on BadJoinKey == BadJoinKey',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.strictEqual(step.join?.rightTable, 'AuditLogs');
        assert.deepStrictEqual(step.join?.keys.map(key => key.name), ['BadJoinKey', 'BadJoinKey']);
    });

    it('resolves let bindings to source tables', () => {
        const model = buildQueryModel(
            'let Recent = SigninLogs | where TimeGenerated > ago(1d);\nRecent\n| where UserPrincipalName contains "@"',
            schema
        );

        assert.strictEqual(model.blocks[0].sourceName, 'Recent');
        assert.strictEqual(model.blocks[0].sourceTable, 'SigninLogs');
    });

    it('provides scope at a cursor line', () => {
        const model = buildQueryModel(
            'SigninLogs\n| project OfficeTime = TimeGenerated, UserPrincipalName\n| where OfficeTime > ago(1d)',
            schema
        );
        const scope = getScopeAtLine(model, 2);

        assert.ok(scope?.columns.includes('OfficeTime'));
        assert.ok(scope?.columns.includes('UserPrincipalName'));
    });

    it('reports a parse issue for a bare pipe', () => {
        const model = buildQueryModel('SigninLogs\n| ', schema);

        assert.ok(model.parseIssues.some(issue => issue.message.includes('Pipe operator')));
    });
});
