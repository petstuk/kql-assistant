import * as assert from 'assert';
import { matchPathGlob } from '../src/pathGlob';

describe('pathGlob', () => {
    it('matches **/*.kql against nested files', () => {
        assert.ok(matchPathGlob('detections/entra/failed.kql', '**/*.kql'));
        assert.ok(matchPathGlob('failed.kql', '**/*.kql'));
        assert.ok(!matchPathGlob('failed.yaml', '**/*.kql'));
    });

    it('matches directory prefixes and braces', () => {
        assert.ok(matchPathGlob('detections/a.yaml', 'detections/**/*.{yaml,yml}'));
        assert.ok(matchPathGlob('detections/b.yml', 'detections/**/*.{yaml,yml}'));
        assert.ok(!matchPathGlob('other/a.yaml', 'detections/**/*.{yaml,yml}'));
    });

    it('matches basename-only patterns anywhere', () => {
        assert.ok(matchPathGlob('vendor/rule.generated.kql', '*.generated.kql'));
        assert.ok(matchPathGlob('rule.generated.kql', '*.generated.kql'));
        assert.ok(!matchPathGlob('vendor/generated.kql', '*.generated.kql'));
    });
});
