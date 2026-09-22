import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applySeverityOverrides, isIgnoredPath, loadLintConfig } from '../src/lintConfig';
import { collectKqlFiles } from '../src/cli';

describe('lintConfig', () => {
    it('drops issues whose code is set to off', () => {
        const issues = applySeverityOverrides(
            [
                { code: 'KQL101', severity: 'information', message: 'time' },
                { code: 'KQL013', severity: 'error', message: 'table' }
            ],
            { KQL101: 'off', KQL013: 'warning' }
        );
        assert.strictEqual(issues.length, 1);
        assert.strictEqual(issues[0].code, 'KQL013');
        assert.strictEqual(issues[0].severity, 'warning');
    });

    it('loads kql-assistant.json by walking up directories', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kql-cfg-'));
        const nested = path.join(root, 'detections', 'entra');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(
            path.join(root, 'kql-assistant.json'),
            JSON.stringify({ ignorePatterns: ['**/skip/**'], severity: { KQL101: 'off' } })
        );
        const loaded = loadLintConfig(nested);
        assert.ok(loaded.path?.endsWith('kql-assistant.json'));
        assert.deepStrictEqual(loaded.config.ignorePatterns, ['**/skip/**']);
    });

    it('honours ignore patterns relative to the config root', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kql-ign-'));
        assert.ok(isIgnoredPath(path.join(root, 'skip', 'a.kql'), root, ['skip/**']));
        assert.ok(!isIgnoredPath(path.join(root, 'keep', 'a.kql'), root, ['skip/**']));
    });
});

describe('collectKqlFiles', () => {
    it('expands globs and applies ignore patterns', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kql-glob-'));
        fs.mkdirSync(path.join(root, 'detections'));
        fs.mkdirSync(path.join(root, 'generated'));
        fs.writeFileSync(path.join(root, 'detections', 'a.kql'), 'SigninLogs\n| take 1\n');
        fs.writeFileSync(path.join(root, 'generated', 'b.kql'), 'SigninLogs\n| take 1\n');
        fs.writeFileSync(path.join(root, 'detections', 'c.yaml'), 'name: x\n');

        const files = collectKqlFiles(['**/*.kql'], root, ['generated/**']);
        assert.strictEqual(files.length, 1);
        assert.ok(files[0].endsWith(path.join('detections', 'a.kql')));
    });
});
