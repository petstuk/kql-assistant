import * as assert from 'assert';
import * as path from 'path';
import { KqlSyntaxChecker } from '../src/syntaxChecker';
import { SchemaStore } from '../src/schemaStore';

const repoRoot = path.join(__dirname, '..', '..');
const bundledSchemaPath = path.join(repoRoot, 'schemas', 'all-tables.json');
const userSchemaPath = path.join(repoRoot, 'test', 'fixtures', 'user-schema.json');

/** Minimal stand-in for KqlSchemaValidator used by the syntax checker */
class TestSchemaValidator {
    constructor(private store: SchemaStore) {}

    validateTableExists(tableName: string): boolean {
        return this.store.validateTableExists(tableName);
    }

    validateColumn(tableName: string, columnName: string): boolean {
        return this.store.validateColumn(tableName, columnName);
    }

    suggestSimilarTable(tableName: string): string | undefined {
        return this.store.suggestSimilarTable(tableName);
    }

    getCanonicalTableName(name: string): string | undefined {
        return this.store.getCanonicalTableName(name);
    }

    getColumns(tableName: string): string[] {
        return this.store.getColumns(tableName);
    }
}

function createChecker(userSchema?: string): KqlSyntaxChecker {
    const store = new SchemaStore(bundledSchemaPath, userSchema);
    const checker = new KqlSyntaxChecker();
    checker.setSchemaValidator(new TestSchemaValidator(store) as never);
    return checker;
}

function hasMessage(errors: ReturnType<KqlSyntaxChecker['check']>, fragment: string): boolean {
    return errors.some(e => e.message.includes(fragment));
}

describe('KqlSyntaxChecker', () => {
    const checker = createChecker();

    it('flags unknown table with suggestion', () => {
        const errors = checker.check('SigninLogz | take 10');
        assert.ok(hasMessage(errors, "Unknown table 'SigninLogz'"));
        assert.ok(hasMessage(errors, 'Did you mean'));
    });

    it('skips unknown table when ignored', () => {
        const local = createChecker();
        local.setIgnoredTables(['SigninLogz']);
        const errors = local.check('SigninLogz | take 10');
        assert.ok(!hasMessage(errors, "Unknown table 'SigninLogz'"));
    });

    it('flags missing pipe before tabular operator', () => {
        const errors = checker.check('SigninLogs\nwhere TimeGenerated > ago(1d)');
        assert.ok(hasMessage(errors, 'Missing pipe operator before \'where\''));
    });

    it('accepts valid SigninLogs column in where', () => {
        const errors = checker.check(
            'SigninLogs\n| where TimeGenerated > ago(1d)\n| take 10'
        );
        assert.ok(!hasMessage(errors, 'Unknown column'));
    });

    it('flags unknown column in where', () => {
        const errors = checker.check(
            'SigninLogs\n| where NotARealColumn == 1\n| take 10'
        );
        assert.ok(hasMessage(errors, "Unknown column 'NotARealColumn'"));
    });

    it('does not flag project alias as unknown column', () => {
        const errors = checker.check(
            'SigninLogs\n| project OfficeTime = TimeGenerated\n| take 10'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'OfficeTime'"));
    });

    it('flags double pipe', () => {
        const errors = checker.check('SigninLogs\n|| where true');
        assert.ok(hasMessage(errors, 'Double pipe'));
    });

    it('flags SQL select keyword', () => {
        const errors = checker.check('SigninLogs\n| select TimeGenerated');
        assert.ok(hasMessage(errors, 'project" instead of "select'));
    });

    it('validates simple mv-expand instead of skipping it', () => {
        const errors = checker.check(
            'SigninLogs\n| mv-expand ExpandedUser = UserPrincipalName\n| take 10'
        );
        assert.ok(!errors.some(e => e.severity === 'information' && e.message.includes('mv-expand')));
        assert.ok(!hasMessage(errors, "Unknown column 'ExpandedUser'"));
    });

    it('validates join key columns on single-line join', () => {
        const errors = checker.check(
            'SigninLogs\n| join kind=inner (AuditLogs) on BadJoinKey == BadJoinKey'
        );
        assert.ok(hasMessage(errors, "Join key column 'BadJoinKey'"));
    });

    it('accepts summarize aliases on later pipes', () => {
        const errors = checker.check(
            'SigninLogs\n| summarize FailedAttempts = count() by UserPrincipalName\n| where FailedAttempts > 3'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'FailedAttempts'"));
    });

    it('accepts multiline summarize aliases', () => {
        const errors = checker.check(
            'SigninLogs\n| summarize\n    FailedAttempts = count(),\n    ResultTypes = make_set(ResultType)\n    by UserPrincipalName\n| where FailedAttempts > 3'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'FailedAttempts'"));
        assert.ok(!hasMessage(errors, "Unknown column 'ResultTypes'"));
    });

    it('keeps outer columns after a join subquery summarize', () => {
        const errors = checker.check(
            'EmailEvents\n| project TimeGenerated, SenderFromAddress, NetworkMessageId\n| join kind=leftouter (\n    EmailUrlInfo\n    | summarize Urls = make_set(Url) by NetworkMessageId\n) on NetworkMessageId\n| project SenderFromAddress, Urls'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'SenderFromAddress'"));
        assert.ok(!hasMessage(errors, "Unknown column 'Urls'"));
        assert.ok(!hasMessage(errors, "Unknown column 'NetworkMessageId'"));
    });

    it('does not flag let scalars as columns', () => {
        const errors = checker.check(
            'let TargetUser = "user@contoso.com";\nSigninLogs\n| where TimeGenerated > ago(1d)\n| where UserPrincipalName has TargetUser'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'TargetUser'"));
    });

    it('keeps let scalars in scope across a blank line', () => {
        const errors = checker.check(
            'let TargetUser = "jane.doe";\n\nIdentityInfo\n| where AccountUPN has TargetUser'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'TargetUser'"));
    });

    it('does not flag dynamic property paths as columns', () => {
        const errors = checker.check(
            'AuditLogs\n| extend Actor = tostring(parse_json(tostring(InitiatedBy)).user.userPrincipalName)\n| project TimeGenerated, Actor'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'user'"));
        assert.ok(!hasMessage(errors, "Unknown column 'userPrincipalName'"));
    });

    it('does not flag render chart types as columns', () => {
        const errors = checker.check(
            'Heartbeat\n| summarize EventCount = count() by bin(TimeGenerated, 1d)\n| render columnchart'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'columnchart'"));
    });

    it('accepts a hunt notebook of separate let-bound queries', () => {
        const errors = checker.check(`# Identity #

let TargetUser = "jane.doe";
IdentityInfo
| where AccountUPN has TargetUser

## Failed burst ##
SigninLogs
| summarize FailedAttempts = count() by UserPrincipalName
| where FailedAttempts > 3

## Password reset ##
let TargetUsers = dynamic(["user@contoso.com"]);
union withsource=SourceTable AuditLogs, SecurityEvent
| where TimeGenerated > ago(3d)
| project TimeGenerated, SourceTable, Identity

## Email ##
let NetworkMessageIdValue = "id";
EmailEvents
| where NetworkMessageId == NetworkMessageIdValue
| project SenderFromAddress, Subject
`);
        const unknown = errors.filter(error => error.message.startsWith('Unknown column'));
        assert.deepStrictEqual(unknown.map(error => error.message), []);
        assert.ok(!hasMessage(errors, 'no "from" keyword needed'));
    });

    it('does not flag SQL from inside a string', () => {
        const errors = checker.check(
            'EmailEvents\n| extend CommunicationType = iff(true, "Sent From Target", "Sent To Target")'
        );
        assert.ok(!hasMessage(errors, 'no "from" keyword needed'));
    });

    it('accepts union withsource columns', () => {
        const errors = checker.check(
            'union withsource=SourceTable AuditLogs, SecurityEvent\n| where TimeGenerated > ago(1d)\n| project TimeGenerated, SourceTable, Identity'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'SourceTable'"));
        assert.ok(!hasMessage(errors, "Unknown column 'TimeGenerated'"));
        assert.ok(!hasMessage(errors, 'current query scope'));
    });

    it('accepts project-rename output name', () => {
        const errors = checker.check(
            'ThreatIntelligenceIndicator\n| project-rename DestinationIP = NetworkIP\n| where isnotempty(DestinationIP)'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'DestinationIP'"));
    });
    it('accepts has_any with a let dynamic list', () => {
        const errors = checker.check(
            'let IocIps = dynamic(["1.2.3.4"]);\nCommonSecurityLog\n| where DestinationIP has_any (IocIps)'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'has_any'"));
        assert.ok(!hasMessage(errors, "Unknown column 'IocIps'"));
    });

    it('validates project-away columns', () => {
        const errors = checker.check(
            'SigninLogs\n| project-away NotARealColumn'
        );
        assert.ok(hasMessage(errors, "Unknown column 'NotARealColumn'"));
    });

    it('keeps query scopes isolated across blocks', () => {
        const withUser = createChecker(userSchemaPath);
        const errors = withUser.check(
            'SigninLogs\n| project OfficeTime = TimeGenerated\n\nCustomAlerts\n| where OfficeTime > ago(1d)'
        );
        assert.ok(hasMessage(errors, "Unknown column 'OfficeTime'"));
    });

    it('resolves table-shaped let bindings', () => {
        const errors = checker.check(
            'let Recent = SigninLogs | where TimeGenerated > ago(1d);\nRecent\n| where UserPrincipalName contains "@"'
        );
        assert.ok(!hasMessage(errors, "Unknown table 'Recent'"));
        assert.ok(!hasMessage(errors, "Unknown column 'UserPrincipalName'"));
    });

    it('validates lookup keys like join', () => {
        const errors = checker.check(
            'SigninLogs\n| lookup kind=leftouter (AuditLogs) on BadLookupKey'
        );
        assert.ok(hasMessage(errors, "Lookup key column 'BadLookupKey'"));
        assert.ok(!errors.some(e => e.message.includes('Column validation is limited')));
    });

    it('accepts datatable IOC list columns', () => {
        const errors = checker.check(
            'let Iocs = datatable(IpAddress:string) ["1.2.3.4"];\nIocs\n| where IpAddress == "1.2.3.4"'
        );
        assert.ok(!hasMessage(errors, "Unknown table 'Iocs'"));
        assert.ok(!hasMessage(errors, "Unknown column 'IpAddress'"));
    });

    it('assigns stable codes to schema diagnostics', () => {
        const errors = checker.check('SigninLogz | take 10');
        assert.ok(errors.some(e => e.code === 'KQL013'));
        const unknownCol = checker.check('SigninLogs\n| where NotARealColumn == 1');
        assert.ok(unknownCol.some(e => e.code === 'KQL014'));
    });

    it('suppresses the next line with kql-disable-next-line', () => {
        const local = createChecker();
        local.setLintMode('basic');
        const errors = local.check(
            'SigninLogs\n| where TimeGenerated > ago(1d)\n// kql-disable-next-line KQL103\n| where UserPrincipalName contains "admin"'
        );
        assert.ok(!hasMessage(errors, 'Prefer has'));
    });

    it('does not suppress other codes on disable-next-line', () => {
        const local = createChecker();
        local.setLintMode('basic');
        const errors = local.check(
            'SigninLogs\n// kql-disable-next-line KQL103\n| where NotARealColumn contains "x"'
        );
        assert.ok(hasMessage(errors, "Unknown column 'NotARealColumn'"));
    });

    it('honours kql-disable-line on the same line', () => {
        const local = createChecker();
        local.setLintMode('basic');
        const errors = local.check(
            'SigninLogs\n| where UserPrincipalName contains "admin" // kql-disable-line KQL103'
        );
        assert.ok(!hasMessage(errors, 'Prefer has'));
    });

    it('loads user schema for custom tables', () => {
        const withUser = createChecker(userSchemaPath);
        const errors = withUser.check(
            'CustomAlerts\n| where AlertId == "x"\n| take 10'
        );
        assert.ok(!hasMessage(errors, "Unknown table 'CustomAlerts'"));
        assert.ok(!hasMessage(errors, "Unknown column 'AlertId'"));
    });

    it('accepts columns extracted by parse', () => {
        const errors = checker.check(
            'Syslog\n| where TimeGenerated > ago(1h)\n| parse SyslogMessage with "user=" User " host=" HostName\n| where User == "root"'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'User'"));
    });

    it('does not flag unknown columns after bag_unpack', () => {
        const errors = checker.check(
            'SigninLogs\n| where TimeGenerated > ago(1h)\n| evaluate bag_unpack(ExtendedProperties)\n| where UnpackedFlag == 1'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'UnpackedFlag'"));
    });

    it('accepts an alias defined in a summarize by clause', () => {
        const errors = checker.check(
            'SigninLogs\n| summarize\n    SignInCount = count()\n    by\n        UserDisplayName,\n        TrustType = tostring(parse_json(tostring(DeviceDetail)).trustType)\n| project UserDisplayName, TrustType'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'TrustType'"));
        assert.ok(!hasMessage(errors, "Unknown column 'DeviceDetail'"));
    });

    it('accepts watchlist columns after a bare lookup on a _GetWatchlist let', () => {
        const errors = checker.check(
            'let DeviceList = _GetWatchlist("Orro_Customer_NGFWs");\nCommonSecurityLog\n| where TimeGenerated > ago(1d)\n| lookup kind=leftouter DeviceList on $left.DeviceName == $right.DeviceName\n| extend DeviceCluster = case(isempty(DeviceCluster), DeviceName, DeviceCluster)\n| summarize Events = count() by DeviceVendor, DeviceCluster, LogGapThreshold'
        );
        assert.ok(!hasMessage(errors, "Unknown column 'DeviceCluster'"));
        assert.ok(!hasMessage(errors, "Unknown column 'LogGapThreshold'"));
    });

    it('still flags unknown columns without a watchlist lookup', () => {
        const errors = checker.check(
            'CommonSecurityLog\n| where TimeGenerated > ago(1d)\n| extend Cluster = DeviceCluster'
        );
        assert.ok(hasMessage(errors, "Unknown column 'DeviceCluster'"));
    });

    it('accepts _GetWatchlist SearchKey', () => {
        const errors = checker.check(
            '_GetWatchlist("HighRiskUsers")\n| where SearchKey == "admin"'
        );
        assert.ok(!hasMessage(errors, "Unknown table"));
        assert.ok(!hasMessage(errors, "Unknown column 'SearchKey'"));
    });
});

describe('SchemaStore', () => {
    it('merges user schema over bundled', () => {
        const store = new SchemaStore(bundledSchemaPath, userSchemaPath);
        assert.ok(store.validateTableExists('SigninLogs'));
        assert.ok(store.validateTableExists('CustomAlerts'));
        assert.ok(store.validateColumn('CustomAlerts', 'Severity'));
    });
});
