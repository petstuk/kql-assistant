import { SyntaxError } from './syntaxChecker';

export interface YamlQueryBlock {
    /** 0-based line of the first KQL content line in the YAML file */
    startLine: number;
    /** Leading spaces on KQL content lines in the YAML file */
    indent: number;
    /** Dedented KQL */
    text: string;
}

export interface ParsedSentinelRule {
    id?: string;
    name?: string;
    description?: string;
    severity?: string;
    queryFrequency?: string;
    queryPeriod?: string;
    triggerOperator?: string;
    triggerThreshold?: string;
    tactics: string[];
    techniques: string[];
    query: string;
    kind?: string;
}

const QUERY_KEY = /^\s*query\s*:\s*(\||>\-?|\|-?)\s*$/i;

/**
 * Find `query: |` (and `|-` / `>`) block scalars. Used for Sentinel analytics
 * and hunting YAML. Indent of the key determines where the block ends.
 */
export function extractYamlQueryBlocks(yaml: string): YamlQueryBlock[] {
    const lines = yaml.split('\n');
    const blocks: YamlQueryBlock[] = [];

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(QUERY_KEY);
        if (!match) {
            continue;
        }
        const keyIndent = leadingSpaces(lines[i]);
        const content: string[] = [];
        let contentIndent: number | undefined;
        let startLine = i + 1;

        let j = i + 1;
        for (; j < lines.length; j++) {
            const line = lines[j];
            const trimmed = line.trim();
            const indent = leadingSpaces(line);

            if (trimmed === '') {
                content.push(line);
                continue;
            }
            if (indent <= keyIndent) {
                break;
            }
            if (contentIndent === undefined) {
                contentIndent = indent;
                startLine = j;
            }
            content.push(line);
        }

        if (contentIndent === undefined) {
            i = j - 1;
            continue;
        }

        const dedented = content.map(line => {
            if (line.trim() === '') {
                return '';
            }
            return line.startsWith(' '.repeat(contentIndent!))
                ? line.slice(contentIndent)
                : line.trimStart();
        });

        while (dedented.length > 0 && dedented[dedented.length - 1] === '') {
            dedented.pop();
        }

        const text = dedented.join('\n');
        if (text.trim() !== '') {
            blocks.push({
                startLine,
                indent: contentIndent,
                text
            });
        }
        i = j - 1;
    }

    return blocks;
}

export function parseSentinelAnalyticsYaml(text: string): ParsedSentinelRule | undefined {
    const queries = extractYamlQueryBlocks(text);
    if (queries.length === 0) {
        return undefined;
    }

    const descriptionBlock = extractNamedBlockScalar(text, 'description');

    return {
        id: extractYamlScalar(text, 'id'),
        name: extractYamlScalar(text, 'name'),
        description: descriptionBlock?.text ?? extractYamlScalar(text, 'description'),
        severity: extractYamlScalar(text, 'severity'),
        queryFrequency: extractYamlScalar(text, 'queryFrequency'),
        queryPeriod: extractYamlScalar(text, 'queryPeriod'),
        triggerOperator: extractYamlScalar(text, 'triggerOperator'),
        triggerThreshold: extractYamlScalar(text, 'triggerThreshold'),
        tactics: extractYamlStringList(text, 'tactics'),
        techniques: extractYamlStringList(text, 'relevantTechniques'),
        query: queries[0].text,
        kind: extractYamlScalar(text, 'kind')
    };
}

/** Convert a Sentinel analytics/hunting YAML document into a ## Rule ## KQL block. */
export function sentinelYamlToKql(text: string): string | undefined {
    const rule = parseSentinelAnalyticsYaml(text);
    if (!rule) {
        return undefined;
    }

    const lines: string[] = [`## ${rule.name ?? 'Imported rule'} ##`];
    if (rule.severity) {
        lines.push(`// severity: ${rule.severity}`);
    }
    for (const tactic of rule.tactics) {
        lines.push(`// tactic: ${tactic}`);
    }
    for (const technique of rule.techniques) {
        lines.push(`// technique: ${technique}`);
    }
    if (rule.description) {
        const first = rule.description.split('\n').map(line => line.trim()).find(line => line.length > 0);
        if (first) {
            lines.push(`// description: ${first}`);
        }
    }
    if (rule.queryFrequency) {
        lines.push(`// queryFrequency: ${rule.queryFrequency}`);
    }
    if (rule.queryPeriod) {
        lines.push(`// queryPeriod: ${rule.queryPeriod}`);
    }
    if (rule.kind) {
        lines.push(`// kind: ${rule.kind}`);
    }
    lines.push('');
    lines.push(rule.query.replace(/\s+$/, ''));
    lines.push('');
    return lines.join('\n');
}

export function remapYamlQueryIssues(
    block: YamlQueryBlock,
    issues: SyntaxError[]
): SyntaxError[] {
    return issues.map(issue => ({
        ...issue,
        line: block.startLine + issue.line,
        column: Math.max(0, block.indent + issue.column)
    }));
}

export function extractYamlScalar(text: string, key: string): string | undefined {
    const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.*)$`, 'im');
    const match = text.match(pattern);
    if (!match) {
        return undefined;
    }
    const raw = match[1].trim();
    if (raw === '' || raw === '|' || raw === '>-' || raw === '|-' || raw === '>') {
        return undefined;
    }
    if (raw === '[]' || raw === '{}') {
        return undefined;
    }
    return unquoteYaml(raw);
}

function extractNamedBlockScalar(
    text: string,
    key: string
): { text: string } | undefined {
    const lines = text.split('\n');
    const header = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*:\\s*(\\||>\\-?|\\|-?)\\s*$`, 'i');
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(header);
        if (!match) {
            continue;
        }
        const keyIndent = leadingSpaces(lines[i]);
        const content: string[] = [];
        let contentIndent: number | undefined;
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            const trimmed = line.trim();
            const indent = leadingSpaces(line);
            if (trimmed === '') {
                content.push('');
                continue;
            }
            if (indent <= keyIndent) {
                break;
            }
            if (contentIndent === undefined) {
                contentIndent = indent;
            }
            content.push(line.slice(contentIndent));
        }
        while (content.length > 0 && content[content.length - 1] === '') {
            content.pop();
        }
        const body = content.join('\n').trim();
        if (body) {
            return { text: body };
        }
    }
    return undefined;
}

function extractYamlStringList(text: string, key: string): string[] {
    const lines = text.split('\n');
    const header = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*:\\s*(.*)$`, 'i');
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(header);
        if (!match) {
            continue;
        }
        const indent = match[1].length;
        const rest = match[2].trim();
        if (rest === '[]') {
            return [];
        }
        if (rest.startsWith('[') && rest.endsWith(']')) {
            return rest
                .slice(1, -1)
                .split(',')
                .map(part => unquoteYaml(part.trim()))
                .filter(Boolean);
        }
        const items: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            if (line.trim() === '') {
                continue;
            }
            const lineIndent = leadingSpaces(line);
            if (lineIndent <= indent) {
                break;
            }
            const item = line.match(/^\s*-\s+(.*)$/);
            if (item) {
                items.push(unquoteYaml(item[1].trim()));
            }
        }
        return items;
    }
    return [];
}

function leadingSpaces(line: string): number {
    const match = line.match(/^[ ]*/);
    return match ? match[0].length : 0;
}

function unquoteYaml(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
