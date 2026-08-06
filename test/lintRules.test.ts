import * as assert from 'assert';
import { runLintRules } from '../src/lintRules';

describe('lintRules', () => {
    it('is silent when mode is off', () => {
        const issues = runLintRules('SigninLogs\n| take 10', { mode: 'off' });
        assert.strictEqual(issues.length, 0);
    });

    it('flags missing early time filter (KQL101)', () => {
        const issues = runLintRules('SigninLogs\n| where ResultType != 0\n| take 10', {
            mode: 'basic'
        });
        assert.ok(issues.some(i => i.code === 'KQL101'));
    });

    it('accepts TimeGenerated + ago as time filter', () => {
        const issues = runLintRules(
            'SigninLogs\n| where TimeGenerated > ago(1d)\n| where ResultType != 0',
            { mode: 'basic' }
        );
        assert.ok(!issues.some(i => i.code === 'KQL101'));
    });

    it('flags contains (KQL103)', () => {
        const issues = runLintRules(
            'SigninLogs\n| where TimeGenerated > ago(1d)\n| where UserPrincipalName contains "admin"',
            { mode: 'basic' }
        );
        assert.ok(issues.some(i => i.code === 'KQL103'));
    });

    it('flags bare search (KQL104)', () => {
        const issues = runLintRules('search "password"', { mode: 'basic' });
        assert.ok(issues.some(i => i.code === 'KQL104'));
    });

    it('allows scoped search in (Table)', () => {
        const issues = runLintRules('search in (SigninLogs) "password"', { mode: 'basic' });
        assert.ok(!issues.some(i => i.code === 'KQL104'));
    });

    it('flags join without kind (KQL102)', () => {
        const issues = runLintRules(
            'SigninLogs\n| where TimeGenerated > ago(1d)\n| join (AuditLogs) on $left.Id == $right.Id',
            { mode: 'basic' }
        );
        assert.ok(issues.some(i => i.code === 'KQL102'));
    });

    it('strict mode adds project-after-join guidance (KQL105)', () => {
        const issues = runLintRules(
            'SigninLogs\n| where TimeGenerated > ago(1d)\n| join kind=inner (AuditLogs) on Id\n| take 10',
            { mode: 'strict' }
        );
        assert.ok(issues.some(i => i.code === 'KQL105'));
    });
});
