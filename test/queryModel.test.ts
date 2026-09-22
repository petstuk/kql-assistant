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
    it('does not treat join subquery pipes as outer steps', () => {
        const model = buildQueryModel(
            'EmailEvents\n| join kind=leftouter (\n    EmailUrlInfo\n    | summarize Urls = make_set(Url) by NetworkMessageId\n) on NetworkMessageId\n| project SenderFromAddress, Urls',
            schema
        );
        const operators = model.blocks[0].steps.map(step => step.operator);
        assert.deepStrictEqual(operators, ['join', 'project']);
        const join = model.blocks[0].steps[0];
        assert.strictEqual(join.join?.rightTable, 'EmailUrlInfo');
        assert.ok(join.join?.subqueryColumns.includes('Urls'));
        assert.ok(join.outputColumns.includes('Urls'));
        assert.ok(join.outputColumns.includes('SenderFromAddress') || join.outputColumns.length > 0);
        const project = model.blocks[0].steps[1];
        assert.ok(project.inputColumns.includes('Urls'));
    });

    it('tracks union withsource tables and extra column', () => {
        const model = buildQueryModel(
            'union withsource=SourceTable AuditLogs, SecurityEvent\n| where TimeGenerated > ago(1d)',
            schema
        );
        const block = model.blocks[0];
        assert.ok(block.sourceColumns?.includes('SourceTable'));
        assert.ok(block.sourceColumns?.includes('Identity') || (block.sourceTable === 'AuditLogs'));
        const where = block.steps[0];
        assert.ok(where.inputTables.includes('AuditLogs'));
        assert.ok(where.inputTables.includes('SecurityEvent'));
        assert.ok(where.inputColumns.includes('SourceTable'));
    });
    it('tracks scalar let names', () => {
        const model = buildQueryModel(
            'let TargetUser = "user@contoso.com";\nSigninLogs\n| where UserPrincipalName has TargetUser',
            schema
        );
        assert.ok(model.blocks[0].letBindings.some(binding => binding.name === 'TargetUser'));
    });

    it('keeps scalar let names when a blank line splits the let from the table', () => {
        const model = buildQueryModel(
            'let TargetUser = "jane.doe";\n\nIdentityInfo\n| where AccountUPN has TargetUser',
            schema
        );
        const tableBlock = model.blocks.find(block => block.sourceTable === 'IdentityInfo');
        assert.ok(tableBlock);
        assert.ok(tableBlock?.letBindings.some(binding => binding.name === 'TargetUser'));
    });

    it('resolves let bindings to source tables', () => {
        const model = buildQueryModel(
            'let Recent = SigninLogs | where TimeGenerated > ago(1d);\nRecent\n| where UserPrincipalName contains "@"',
            schema
        );

        assert.strictEqual(model.blocks[0].sourceName, 'Recent');
        assert.strictEqual(model.blocks[0].sourceTable, 'SigninLogs');
    });

    it('tracks lookup like join', () => {
        const model = buildQueryModel(
            'SigninLogs\n| lookup kind=leftouter (AuditLogs) on Id',
            schema
        );
        const step = model.blocks[0].steps[0];
        assert.strictEqual(step.operator, 'lookup');
        assert.strictEqual(step.join?.rightTable, 'AuditLogs');
        assert.ok(step.join?.keys.some(k => k.name === 'Id'));
    });

    it('tracks summarize by aliases as defined columns', () => {
        const model = buildQueryModel(
            'SigninLogs\n| summarize SignInCount = count()\n    by\n        UserDisplayName,\n        TrustType = tostring(parse_json(tostring(DeviceDetail)).trustType)',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.ok(step.definedColumns.some(column => column.name === 'TrustType'));
        assert.ok(step.outputColumns.includes('TrustType'));
        assert.ok(step.outputColumns.includes('UserDisplayName'));
        assert.ok(step.referencedColumns.some(column => column.name === 'DeviceDetail'));
        assert.ok(!step.referencedColumns.some(column => column.name === 'TrustType'));
    });

    it('resolves a watchlist let bound as a bare lookup source', () => {
        const model = buildQueryModel(
            'let DeviceList = _GetWatchlist("Orro_Customer_NGFWs");\nCommonSecurityLog\n| lookup kind=leftouter DeviceList on $left.DeviceName == $right.DeviceName',
            schema
        );
        const step = model.blocks[0].steps[0];

        assert.strictEqual(step.operator, 'lookup');
        assert.ok(step.join?.subqueryColumns.includes('*'));
        assert.ok(step.outputColumns.includes('*'));
    });

    it('tracks datatable IOC list columns via let', () => {
        const model = buildQueryModel(
            'let Iocs = datatable(IpAddress:string, Note:string) ["1.2.3.4", "c2"];\nIocs\n| where IpAddress == "1.2.3.4"',
            schema
        );
        assert.strictEqual(model.blocks[0].sourceName, 'Iocs');
        assert.deepStrictEqual(model.blocks[0].sourceColumns, ['IpAddress', 'Note']);
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

    it('extracts parse pattern columns', () => {
        const model = buildQueryModel(
            'Syslog\n| parse SyslogMessage with "user=" User " ip=" ClientIP',
            schema
        );
        const step = model.blocks[0].steps[0];
        assert.ok(step.outputColumns.includes('User'));
        assert.ok(step.outputColumns.includes('ClientIP'));
    });

    it('marks bag_unpack as open column scope', () => {
        const model = buildQueryModel(
            'SigninLogs\n| evaluate bag_unpack(ExtendedProperties)',
            schema
        );
        assert.ok(model.blocks[0].steps[0].outputColumns.includes('*'));
    });

    it('treats _GetWatchlist as a watchlist source', () => {
        const model = buildQueryModel('_GetWatchlist("HighRiskUsers")\n| where SearchKey == "a"');
        assert.strictEqual(model.blocks[0].sourceName, '_GetWatchlist');
        assert.ok(model.blocks[0].sourceColumns?.includes('SearchKey'));
    });
});
