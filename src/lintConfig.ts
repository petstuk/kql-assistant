import * as fs from 'fs';
import * as path from 'path';
import { LintMode } from './lintRules';
import { matchPathGlob } from './pathGlob';

export type SeverityName = 'error' | 'warning' | 'information' | 'off';

export interface LintConfigFile {
    lint?: LintMode;
    packs?: string[];
    userSchemaPath?: string;
    failOn?: 'error' | 'warning' | 'information';
    ignorePatterns?: string[];
    severity?: Record<string, SeverityName>;
}

export const CONFIG_FILENAMES = ['kql-assistant.json', '.kql-assistant.json'];

export function findLintConfigPath(startDir: string): string | undefined {
    let dir = path.resolve(startDir);
    while (true) {
        for (const name of CONFIG_FILENAMES) {
            const candidate = path.join(dir, name);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

export function loadLintConfigFile(configPath: string): LintConfigFile {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as LintConfigFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
}

export function loadLintConfig(startDir: string): { path?: string; config: LintConfigFile } {
    const configPath = findLintConfigPath(startDir);
    if (!configPath) {
        return { config: {} };
    }
    return { path: configPath, config: loadLintConfigFile(configPath) };
}

export function applySeverityOverrides<T extends { code?: string; severity?: string }>(
    issues: T[],
    severity: Record<string, SeverityName> | undefined
): T[] {
    if (!severity || Object.keys(severity).length === 0) {
        return issues;
    }
    const result: T[] = [];
    for (const issue of issues) {
        const code = issue.code;
        if (!code) {
            result.push(issue);
            continue;
        }
        const override = severity[code] ?? severity[code.toUpperCase()];
        if (!override) {
            result.push(issue);
            continue;
        }
        if (override === 'off') {
            continue;
        }
        result.push({ ...issue, severity: override });
    }
    return result;
}

export function isIgnoredPath(
    filePath: string,
    cwd: string,
    ignorePatterns: string[] | undefined
): boolean {
    if (!ignorePatterns || ignorePatterns.length === 0) {
        return false;
    }
    const relative = path.relative(cwd, path.resolve(filePath)).replace(/\\/g, '/');
    return ignorePatterns.some(pattern => matchPathGlob(relative, pattern) || matchPathGlob(filePath, pattern));
}
