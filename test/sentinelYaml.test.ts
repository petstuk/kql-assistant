import * as assert from 'assert';
import * as path from 'path';
import {
    extractYamlQueryBlocks,
    kqlRangeToYaml,
    queryBlockAt,
    remapYamlQueryIssues,
    sentinelYamlToKql,
    yamlRangeToKql
} from '../src/sentinelYaml';
import { KqlSyntaxChecker } from '../src/syntaxChecker';
import { SchemaStore } from '../src/schemaStore';

const sampleYaml = `id: 11111111-2222-4333-8444-555555555555
name: Suspicious sign-ins
description: |
  Burst of failed Entra sign-ins
severity: Medium
requiredDataConnectors:
  - connectorId: AzureActiveDirectory
    dataTypes:
      - SigninLogs
queryFrequency: 1h
queryPeriod: 1h
triggerOperator: gt
triggerThreshold: 0
tactics:
  - CredentialAccess
relevantTechniques:
  - T1110.001
query: |
  SigninLogs
  | where TimeGenerated > ago(1h)
  | where ResultType != 0
entityMappings:
  - entityType: Account
    fieldMappings:
      - identifier: FullName
        columnName: UserPrincipalName
kind: Scheduled
`;

const yamlWithUnknownTable = `name: Broken
query: |
  NotARealTable123
  | take 1
`;

describe('sentinelYaml', () => {
    it('extracts indented query: | blocks', () => {
        const blocks = extractYamlQueryBlocks(sampleYaml);
        assert.strictEqual(blocks.length, 1);
        assert.ok(blocks[0].text.startsWith('SigninLogs'));
        assert.ok(blocks[0].text.includes('| where ResultType != 0'));
        assert.ok(!blocks[0].text.includes('entityMappings'));
        assert.ok(blocks[0].indent >= 2);
    });

    it('imports YAML into a ## Rule ## KQL block', () => {
        const kql = sentinelYamlToKql(sampleYaml);
        assert.ok(kql);
        assert.ok(kql!.startsWith('## Suspicious sign-ins ##'));
        assert.ok(kql!.includes('// severity: Medium'));
        assert.ok(kql!.includes('// tactic: CredentialAccess'));
        assert.ok(kql!.includes('// technique: T1110.001'));
        assert.ok(kql!.includes('// description: Burst of failed Entra sign-ins'));
        assert.ok(kql!.includes('// queryFrequency: 1h'));
        assert.ok(kql!.includes('// kind: Scheduled'));
        assert.ok(kql!.includes('SigninLogs\n| where TimeGenerated > ago(1h)'));
    });

    it('returns undefined when YAML has no query block', () => {
        assert.strictEqual(sentinelYamlToKql('name: No query\n'), undefined);
    });

    it('remaps KQL diagnostics onto YAML query lines', () => {
        const repoRoot = path.join(__dirname, '..', '..');
        const store = new SchemaStore(path.join(repoRoot, 'schemas', 'all-tables.json'));
        const checker = new KqlSyntaxChecker();
        checker.setSchemaValidator({
            validateTableExists: t => store.validateTableExists(t),
            validateColumn: (t, c) => store.validateColumn(t, c),
            suggestSimilarTable: t => store.suggestSimilarTable(t),
            getCanonicalTableName: t => store.getCanonicalTableName(t),
            getColumns: t => store.getColumns(t)
        });
        checker.setLintMode('off');

        const blocks = extractYamlQueryBlocks(yamlWithUnknownTable);
        assert.strictEqual(blocks.length, 1);
        const issues = remapYamlQueryIssues(blocks[0], checker.check(blocks[0].text));
        const unknown = issues.find(issue => issue.code === 'KQL013');
        assert.ok(unknown, 'expected unknown-table diagnostic');
        const lines = yamlWithUnknownTable.split('\n');
        assert.strictEqual(lines[unknown!.line].includes('NotARealTable123'), true);
        assert.ok(unknown!.column >= blocks[0].indent);
    });

    it('keeps KQL lines aligned when a blank line follows query: |', () => {
        const yaml = [
            'name: Example',
            'query: |',
            '',
            '  SigninLogs',
            '  | where TimeGenerated > ago(1h)',
            '',
            '  | take 5',
            'entityMappings: []'
        ].join('\n');

        const blocks = extractYamlQueryBlocks(yaml);
        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(
            blocks[0].text,
            'SigninLogs\n| where TimeGenerated > ago(1h)\n\n| take 5'
        );
        assert.strictEqual(yaml.split('\n')[blocks[0].startLine], '  SigninLogs');

        const whereLine = blocks[0].startLine + 1;
        const hit = queryBlockAt(yaml, whereLine, 4);
        assert.ok(hit);
        assert.strictEqual(hit!.kqlLine, 1);
        assert.strictEqual(hit!.kqlCharacter, 2);
        assert.strictEqual(hit!.block.text.split('\n')[hit!.kqlLine], '| where TimeGenerated > ago(1h)');

        const takeLine = blocks[0].startLine + 3;
        const take = queryBlockAt(yaml, takeLine, 2);
        assert.ok(take);
        assert.strictEqual(take!.kqlLine, 3);
        assert.strictEqual(take!.block.text.split('\n')[3].trim(), '| take 5');
    });

    it('ignores cursors outside the query block', () => {
        const yaml = 'name: Example\nquery: |\n  SigninLogs\nkind: Scheduled\n';
        assert.strictEqual(queryBlockAt(yaml, 0, 0), undefined);
        assert.strictEqual(queryBlockAt(yaml, 1, 0), undefined);
        const inside = queryBlockAt(yaml, 2, 2);
        assert.ok(inside);
        assert.strictEqual(inside!.kqlLine, 0);
        assert.strictEqual(inside!.kqlCharacter, 0);
    });

    it('round-trips a KQL range onto YAML indent and back', () => {
        const yaml = 'query: |\n  SigninLogs\n  | where TimeGenerated > ago(1h)\n';
        const hit = queryBlockAt(yaml, 2, 12);
        assert.ok(hit);
        const kql = {
            start: { line: 1, character: 8 },
            end: { line: 1, character: 21 }
        };
        const yamlRange = kqlRangeToYaml(hit!.block, kql);
        assert.deepStrictEqual(yamlRange, {
            start: { line: hit!.block.startLine + 1, character: hit!.block.indent + 8 },
            end: { line: hit!.block.startLine + 1, character: hit!.block.indent + 21 }
        });
        assert.deepStrictEqual(yamlRangeToKql(hit!.block, yamlRange), kql);
        const line = yaml.split('\n')[yamlRange.start.line];
        assert.strictEqual(line.slice(yamlRange.start.character, yamlRange.end.character), 'TimeGenerated');
    });
});
