import * as assert from 'assert';
import { buildAnalyticsRuleYaml } from '../src/analyticsRuleExport';
import {
    findRuleAtLine,
    getRuleQueryText,
    parseMetadataLines,
    tacticDisplayName
} from '../src/ruleMetadata';

const sample = `# Identity #

## Suspicious sign-ins ##
// tactic: TA0006
// technique: T1110.001
// severity: Medium
// description: Burst of failed Entra sign-ins
// queryFrequency: 1h
SigninLogs
| where TimeGenerated > ago(1h)
| where ResultType != 0

## Other ##
SecurityEvent
| take 1
`;

describe('ruleMetadata', () => {
    it('maps tactic IDs to Sentinel names', () => {
        assert.strictEqual(tacticDisplayName('TA0006'), 'CredentialAccess');
    });

    it('parses metadata comment lines', () => {
        const meta = parseMetadataLines([
            '// tactic: TA0006',
            '// technique: T1110',
            '// severity: high'
        ]);
        assert.deepStrictEqual(meta.tactics, ['CredentialAccess']);
        assert.deepStrictEqual(meta.techniques, ['T1110']);
        assert.strictEqual(meta.severity, 'High');
    });

    it('finds rule at cursor and strips metadata from query', () => {
        const rule = findRuleAtLine(sample, 8);
        assert.ok(rule);
        assert.strictEqual(rule!.title, 'Suspicious sign-ins');
        assert.strictEqual(rule!.severity, 'Medium');
        assert.deepStrictEqual(rule!.techniques, ['T1110.001']);
        const query = getRuleQueryText(sample, rule!);
        assert.ok(query.startsWith('SigninLogs'));
        assert.ok(!query.includes('tactic:'));
    });

    it('exports analytics rule YAML stub', () => {
        const rule = findRuleAtLine(sample, 5);
        assert.ok(rule);
        const yaml = buildAnalyticsRuleYaml(sample, rule!);
        assert.ok(yaml.includes('name: Suspicious sign-ins'));
        assert.ok(yaml.includes('severity: Medium'));
        assert.ok(yaml.includes('CredentialAccess'));
        assert.ok(yaml.includes('T1110.001'));
        assert.ok(yaml.includes('kind: Scheduled'));
        assert.ok(yaml.includes('SigninLogs'));
        assert.ok(!yaml.includes('// tactic'));
    });
});
