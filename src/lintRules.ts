import { buildQueryModel, QueryBlock } from './queryModel';

export type LintMode = 'off' | 'basic' | 'strict';

export interface LintIssue {
    line: number;
    column: number;
    length: number;
    message: string;
    severity: 'warning' | 'information';
    code: string;
}

export interface LintOptions {
    mode: LintMode;
}

const TIME_COLUMN_PATTERN =
    /\b(TimeGenerated|EventTime|EventStartTime|StartTime|Timestamp|TimeCreated)\b/i;
const TIME_BOUND_PATTERN =
    /\b(ago|between|startofday|startofweek|startofmonth|datetime)\s*\(/i;

/**
 * Offline detection / cost heuristics for security-engineering KQL.
 * Codes: KQL1xx = cost/performance guidance.
 */
export function runLintRules(text: string, options: LintOptions): LintIssue[] {
    if (options.mode === 'off') {
        return [];
    }

    const issues: LintIssue[] = [];
    const model = buildQueryModel(text);
    const lines = text.split('\n');

    for (const block of model.blocks) {
        lintMissingTimeFilter(block, lines, options.mode, issues);
        lintJoinWithoutKind(block, lines, issues);
        if (options.mode === 'strict') {
            lintProjectAfterHeavyOps(block, issues);
        }
    }

    lintContainsUsage(lines, options.mode, issues);
    lintBareSearchOrFind(lines, issues);

    return issues;
}

function lintMissingTimeFilter(
    block: QueryBlock,
    lines: string[],
    mode: LintMode,
    issues: LintIssue[]
): void {
    if (!block.sourceTable && !block.sourceName) {
        return;
    }
    const source = block.sourceName ?? '';
    if (/^(print|datatable|range)$/i.test(source)) {
        return;
    }

    const blockText = lines.slice(block.startLine, block.endLine + 1).join('\n');
    const hasTimeBound =
        TIME_COLUMN_PATTERN.test(blockText) && TIME_BOUND_PATTERN.test(blockText);
    if (hasTimeBound) {
        return;
    }

    if (/\bwhere\b[\s\S]{0,120}\bago\s*\(/i.test(blockText)) {
        return;
    }

    const line = block.sourceLine ?? block.startLine;
    const column = block.sourceColumn ?? 0;
    const length = (block.sourceName ?? 'query').length;
    issues.push({
        line,
        column,
        length,
        code: 'KQL101',
        severity: mode === 'strict' ? 'warning' : 'information',
        message:
            'No early time filter detected — add `| where TimeGenerated > ago(...)` (or EventTime) near the top to limit scan cost'
    });
}

function lintJoinWithoutKind(
    block: QueryBlock,
    lines: string[],
    issues: LintIssue[]
): void {
    for (const step of block.steps) {
        if (step.operator !== 'join') {
            continue;
        }
        const lineText = lines[step.line] ?? '';
        if (/\bkind\s*=/i.test(lineText) || /\bkind\s*=/i.test(step.args)) {
            continue;
        }
        issues.push({
            line: step.line,
            column: step.column,
            length: 'join'.length,
            code: 'KQL102',
            severity: 'information',
            message:
                'Join without kind= — specify kind (e.g. inner, leftouter) for clearer and cheaper joins'
        });
    }
}

function lintContainsUsage(
    lines: string[],
    mode: LintMode,
    issues: LintIssue[]
): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*\/\//.test(line) || /^\s*#/.test(line)) {
            continue;
        }
        const match = /\bcontains\b/i.exec(line);
        if (!match) {
            continue;
        }
        const idx = match.index;
        if (line[idx - 1] === '!' && mode !== 'strict') {
            continue;
        }
        if (line.slice(idx + 'contains'.length).startsWith('_')) {
            continue;
        }
        issues.push({
            line: i,
            column: idx,
            length: 'contains'.length,
            code: 'KQL103',
            severity: mode === 'strict' ? 'warning' : 'information',
            message:
                'Prefer has / has_any over contains for term matches on large tables (cheaper index use)'
        });
    }
}

function lintBareSearchOrFind(lines: string[], issues: LintIssue[]): void {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (/^\s*\/\//.test(line) || /^\s*#/.test(line)) {
            continue;
        }

        const searchMatch = /^(?:\|\s*)?(search|find)\b/i.exec(trimmed);
        if (!searchMatch) {
            continue;
        }
        const op = searchMatch[1].toLowerCase();
        if (/\bin\s*\(/i.test(trimmed)) {
            continue;
        }
        const column = line.indexOf(searchMatch[1]);
        issues.push({
            line: i,
            column: column >= 0 ? column : 0,
            length: op.length,
            code: 'KQL104',
            severity: 'warning',
            message: `Bare ${op} can scan broadly — prefer a table source or ${op} in (Table1, Table2)`
        });
    }
}

function lintProjectAfterHeavyOps(block: QueryBlock, issues: LintIssue[]): void {
    let sawJoinOrUnion = false;
    let joinLine = 0;
    let joinCol = 0;
    for (const step of block.steps) {
        if (step.operator === 'join' || step.operator === 'union' || step.operator === 'lookup') {
            sawJoinOrUnion = true;
            joinLine = step.line;
            joinCol = step.column;
        }
        if (sawJoinOrUnion && (step.operator === 'project' || step.operator === 'project-keep')) {
            return;
        }
    }
    if (!sawJoinOrUnion) {
        return;
    }
    const hasProjectBefore = block.steps.some(
        s =>
            (s.operator === 'project' || s.operator === 'project-keep') &&
            s.line < joinLine
    );
    if (hasProjectBefore) {
        return;
    }
    issues.push({
        line: joinLine,
        column: joinCol,
        length: 4,
        code: 'KQL105',
        severity: 'information',
        message:
            'Consider project/project-keep before or soon after join/union to reduce shuffled columns'
    });
}
