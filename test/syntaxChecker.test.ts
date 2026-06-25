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

    it('validates join key columns on multiline join', () => {
        const errors = checker.check(
            'SigninLogs\n| join kind=inner (\n    AuditLogs\n) on BadJoinKey == BadJoinKey'
        );
        assert.ok(hasMessage(errors, "Join key column 'BadJoinKey'"));
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

    it('keeps lookup transparency notice', () => {
        const errors = checker.check(
            'SigninLogs\n| lookup AuditLogs on Id'
        );
        const notice = errors.find(e => e.severity === 'information');
        assert.ok(notice);
        assert.ok(notice!.message.includes('lookup'));
    });

    it('loads user schema for custom tables', () => {
        const withUser = createChecker(userSchemaPath);
        const errors = withUser.check(
            'CustomAlerts\n| where AlertId == "x"\n| take 10'
        );
        assert.ok(!hasMessage(errors, "Unknown table 'CustomAlerts'"));
        assert.ok(!hasMessage(errors, "Unknown column 'AlertId'"));
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
