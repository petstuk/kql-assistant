/** Minimal glob matching for CLI file collection (no extra dependencies). */

const GLOB_CHARS = /[*?[{]/;

export function hasGlobChars(pattern: string): boolean {
    return GLOB_CHARS.test(pattern);
}

export function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function expandBraces(pattern: string): string[] {
    const match = pattern.match(/\{([^{}]+)\}/);
    if (!match || match.index === undefined) {
        return [pattern];
    }
    const alternatives = match[1].split(',');
    const results: string[] = [];
    for (const alt of alternatives) {
        const expanded =
            pattern.slice(0, match.index) + alt + pattern.slice(match.index + match[0].length);
        results.push(...expandBraces(expanded));
    }
    return results;
}

export function matchPathGlob(filePath: string, pattern: string): boolean {
    const normalized = normalizePath(filePath);
    const basename = normalized.split('/').pop() ?? normalized;
    for (const expanded of expandBraces(normalizePath(pattern))) {
        const candidates = expanded.includes('/') ? [expanded] : [expanded, `**/${expanded}`];
        for (const candidate of candidates) {
            const regex = globToRegExp(candidate);
            if (regex.test(normalized) || regex.test(basename)) {
                return true;
            }
        }
    }
    return false;
}

export function globToRegExp(pattern: string): RegExp {
    let i = 0;
    let out = '^';
    const p = normalizePath(pattern);
    while (i < p.length) {
        if (p[i] === '*' && p[i + 1] === '*') {
            if (p[i + 2] === '/') {
                out += '(?:.*/)?';
                i += 3;
            } else {
                out += '.*';
                i += 2;
            }
            continue;
        }
        if (p[i] === '*') {
            out += '[^/]*';
            i++;
            continue;
        }
        if (p[i] === '?') {
            out += '[^/]';
            i++;
            continue;
        }
        out += escapeRegExp(p[i]);
        i++;
    }
    out += '$';
    return new RegExp(out, 'i');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
