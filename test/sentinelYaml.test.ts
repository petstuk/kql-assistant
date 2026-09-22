import * as assert from 'assert';
import * as path from 'path';
import {
    extractYamlQueryBlocks,
    remapYamlQueryIssues,
    sentinelYamlToKql
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
});
