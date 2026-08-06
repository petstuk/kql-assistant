/**
 * Detection-rule metadata parsed from comments under ## Rule ## headers.
 *
 * Supported forms (case-insensitive keys):
 *   // tactic: TA0006
 *   // technique: T1110.001
 *   // severity: Medium
 *   // description: Failed sign-in burst
 *   // queryFrequency: 1h
 *   // queryPeriod: 1h
 */

export interface RuleMetadata {
    title: string;
    headerLine: number;
    queryStartLine: number;
    queryEndLine: number;
    tactics: string[];
    techniques: string[];
    severity?: string;
    description?: string;
    queryFrequency?: string;
    queryPeriod?: string;
    triggerOperator?: string;
    triggerThreshold?: string;
}

const TACTIC_NAMES: Record<string, string> = {
    TA0001: 'InitialAccess',
    TA0002: 'Execution',
    TA0003: 'Persistence',
    TA0004: 'PrivilegeEscalation',
    TA0005: 'DefenseEvasion',
    TA0006: 'CredentialAccess',
    TA0007: 'Discovery',
    TA0008: 'LateralMovement',
    TA0009: 'Collection',
    TA0010: 'Exfiltration',
    TA0011: 'CommandAndControl',
    TA0040: 'Impact',
    TA0042: 'ResourceDevelopment',
    TA0043: 'Reconnaissance'
};

const META_LINE =
    /^\s*\/\/\s*@?([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*(.+?)\s*$/;

export function isRuleHeader(text: string): boolean {
    return /^##\s+.+\s+##\s*$/.test(text.trim());
}

export function isCategoryHeader(text: string): boolean {
    const trimmed = text.trim();
    return /^#\s+[^#].+[^#]\s*#\s*$/.test(trimmed) && !trimmed.startsWith('##');
}

export function extractRuleTitle(headerLine: string): string {
    const match = headerLine.trim().match(/^##\s+(.+?)\s+##\s*$/);
    return match ? match[1].trim() : headerLine.trim();
}

export function tacticDisplayName(tactic: string): string {
    const key = tactic.trim().toUpperCase();
    return TACTIC_NAMES[key] ?? tactic.trim();
}

/** Normalize technique IDs (keep Txxxx / Txxxx.xxx). */
export function normalizeTechnique(value: string): string {
    const trimmed = value.trim();
    const match = trimmed.match(/^(T\d{4})(?:\.(\d{3}))?/i);
    if (!match) {
        return trimmed;
    }
    return match[2] ? `${match[1].toUpperCase()}.${match[2]}` : match[1].toUpperCase();
}

export function parseMetadataLines(lines: string[]): Partial<RuleMetadata> {
    const meta: Partial<RuleMetadata> = {
        tactics: [],
        techniques: []
    };

    for (const line of lines) {
        const match = line.match(META_LINE);
        if (!match) {
            continue;
        }
        const key = match[1].toLowerCase().replace(/-/g, '');
        const value = match[2].trim();
        switch (key) {
            case 'tactic':
            case 'tactics':
                meta.tactics = [
                    ...(meta.tactics ?? []),
                    ...splitList(value).map(tacticDisplayName)
                ];
                break;
            case 'technique':
            case 'techniques':
                meta.techniques = [
                    ...(meta.techniques ?? []),
                    ...splitList(value).map(normalizeTechnique)
                ];
                break;
            case 'severity':
                meta.severity = capitalizeSeverity(value);
                break;
            case 'description':
            case 'desc':
                meta.description = value;
                break;
            case 'queryfrequency':
            case 'frequency':
                meta.queryFrequency = value;
                break;
            case 'queryperiod':
            case 'period':
                meta.queryPeriod = value;
                break;
            case 'triggeroperator':
                meta.triggerOperator = value;
                break;
            case 'triggerthreshold':
            case 'threshold':
                meta.triggerThreshold = value;
                break;
            default:
                break;
        }
    }

    meta.tactics = unique(meta.tactics ?? []);
    meta.techniques = unique(meta.techniques ?? []);
    return meta;
}

/**
 * Find the rule section containing `lineNumber` and parse header + metadata + query span.
 */
export function findRuleAtLine(text: string, lineNumber: number): RuleMetadata | undefined {
    const lines = text.split('\n');
    let headerLine = -1;

    for (let i = Math.min(lineNumber, lines.length - 1); i >= 0; i--) {
        if (isRuleHeader(lines[i])) {
            headerLine = i;
            break;
        }
        if (isCategoryHeader(lines[i])) {
            break;
        }
    }

    if (headerLine === -1) {
        return undefined;
    }

    let endLine = headerLine;
    for (let i = headerLine + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (isRuleHeader(trimmed) || isCategoryHeader(trimmed)) {
            break;
        }
        if (trimmed !== '') {
            endLine = i;
        }
    }

    const metaLines: string[] = [];
    let queryStart = headerLine + 1;
    for (let i = headerLine + 1; i <= endLine; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '') {
            continue;
        }
        if (META_LINE.test(lines[i])) {
            metaLines.push(lines[i]);
            queryStart = i + 1;
            continue;
        }
        // First non-meta content starts the query
        queryStart = i;
        break;
    }

    const parsed = parseMetadataLines(metaLines);
    return {
        title: extractRuleTitle(lines[headerLine]),
        headerLine,
        queryStartLine: queryStart,
        queryEndLine: endLine,
        tactics: parsed.tactics ?? [],
        techniques: parsed.techniques ?? [],
        severity: parsed.severity,
        description: parsed.description,
        queryFrequency: parsed.queryFrequency,
        queryPeriod: parsed.queryPeriod,
        triggerOperator: parsed.triggerOperator,
        triggerThreshold: parsed.triggerThreshold
    };
}

/** Query body for a rule, excluding metadata comments. */
export function getRuleQueryText(text: string, rule: RuleMetadata): string {
    const lines = text.split('\n');
    const body: string[] = [];
    for (let i = rule.queryStartLine; i <= rule.queryEndLine; i++) {
        if (META_LINE.test(lines[i])) {
            continue;
        }
        body.push(lines[i]);
    }
    while (body.length > 0 && body[0].trim() === '') {
        body.shift();
    }
    while (body.length > 0 && body[body.length - 1].trim() === '') {
        body.pop();
    }
    return body.join('\n');
}

export function formatMetadataSummary(rule: RuleMetadata): string {
    const parts: string[] = [];
    if (rule.severity) {
        parts.push(rule.severity);
    }
    if (rule.techniques.length > 0) {
        parts.push(rule.techniques.slice(0, 3).join(', '));
    } else if (rule.tactics.length > 0) {
        parts.push(rule.tactics.slice(0, 2).join(', '));
    }
    return parts.join(' · ');
}

function splitList(value: string): string[] {
    return value
        .split(/[,;/|]/)
        .map(part => part.trim())
        .filter(Boolean);
}

function capitalizeSeverity(value: string): string {
    const lower = value.toLowerCase();
    if (lower === 'informational' || lower === 'info') {
        return 'Informational';
    }
    if (lower === 'low' || lower === 'medium' || lower === 'high') {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    return value;
}

function unique(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const key = value.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(value);
    }
    return result;
}
