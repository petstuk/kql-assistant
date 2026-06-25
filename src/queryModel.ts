import { ParsedPipe, ParsedQueryBlock, parseKqlDocument, ParseIssue } from './parserAdapter';

export interface QuerySchemaProvider {
    validateTableExists(tableName: string): boolean;
    validateColumn(tableName: string, columnName: string): boolean;
    getCanonicalTableName(name: string): string | undefined;
    getColumns(tableName: string): string[];
    suggestSimilarTable(tableName: string): string | undefined;
}

export interface ColumnReference {
    name: string;
    line: number;
    column: number;
}

export interface LetBinding {
    name: string;
    sourceTable?: string;
    line: number;
}

export interface JoinInfo {
    line: number;
    column: number;
    rightTable?: string;
    keys: ColumnReference[];
}

export interface QueryStep {
    operator: string;
    args: string;
    line: number;
    column: number;
    inputTables: string[];
    outputTables: string[];
    inputColumns: string[];
    outputColumns: string[];
    referencedColumns: ColumnReference[];
    definedColumns: ColumnReference[];
    removedColumns: ColumnReference[];
    join?: JoinInfo;
}

export interface QueryBlock {
    startLine: number;
    endLine: number;
    sourceName?: string;
    sourceTable?: string;
    sourceLine?: number;
    sourceColumn?: number;
    letBindings: LetBinding[];
    steps: QueryStep[];
}

export interface QueryModel {
    blocks: QueryBlock[];
    parseIssues: ParseIssue[];
}

const BUILTINS = new Set([
    'and', 'or', 'not', 'true', 'false', 'null', 'by', 'on', 'kind', 'inner', 'leftouter',
    'rightouter', 'fullouter', 'leftanti', 'rightanti', 'leftsemi', 'rightsemi', 'asc', 'desc',
    'nulls', 'first', 'last', 'contains', 'has', 'startswith', 'endswith', 'matches', 'regex',
    'in', 'between', 'ago', 'now', 'datetime', 'timespan', 'guid', 'bin', 'count', 'sum',
    'avg', 'min', 'max', 'dcount', 'countif', 'sumif', 'make_list', 'make_set', 'make_bag',
    'iff', 'iif', 'case', 'tostring', 'toint', 'tolong', 'todouble', 'todatetime', 'dynamic',
    'parse_json', 'extract', 'format_datetime', 'project', 'extend', 'summarize', 'where',
    'join', 'union', 'mv-expand', 'lookup', 'project-away', 'project-keep', 'project-rename',
    'order', 'sort', 'take', 'limit', 'render'
]);

export function buildQueryModel(text: string, schema?: QuerySchemaProvider): QueryModel {
    const parsed = parseKqlDocument(text);
    const letBindings = collectLetBindings(parsed.blocks, schema);
    const blocks = parsed.blocks.map(block => buildBlock(block, letBindings, schema));
    return { blocks, parseIssues: parsed.issues };
}

export function findBlockAtLine(model: QueryModel, line: number): QueryBlock | undefined {
    return model.blocks.find(block => line >= block.startLine && line <= block.endLine);
}

export function findStepAtLine(block: QueryBlock, line: number): QueryStep | undefined {
    let current: QueryStep | undefined;
    for (const step of block.steps) {
        if (step.line <= line) {
            current = step;
        }
    }
    return current;
}

export function getScopeAtLine(model: QueryModel, line: number): { tables: string[]; columns: string[] } | undefined {
    const block = findBlockAtLine(model, line);
    if (!block) {
        return undefined;
    }

    const step = findStepAtLine(block, line);
    if (step) {
        return {
            tables: step.outputTables,
            columns: step.outputColumns
        };
    }

    return {
        tables: block.sourceTable ? [block.sourceTable] : [],
        columns: []
    };
}

function collectLetBindings(blocks: ParsedQueryBlock[], schema?: QuerySchemaProvider): Map<string, LetBinding> {
    const bindings = new Map<string, LetBinding>();
    for (const block of blocks) {
        for (let offset = 0; offset < block.lines.length; offset++) {
            const line = block.lines[offset];
            const match = line.match(/^\s*let\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)/i);
            if (!match) {
                continue;
            }
            const name = match[1];
            const source = canonicalTable(match[2], schema);
            bindings.set(name.toLowerCase(), {
                name,
                sourceTable: source,
                line: block.startLine + offset
            });
        }
    }
    return bindings;
}

function buildBlock(
    parsedBlock: ParsedQueryBlock,
    allLetBindings: Map<string, LetBinding>,
    schema?: QuerySchemaProvider
): QueryBlock {
    const ownLetBindings: LetBinding[] = [];
    let sourceName: string | undefined;
    let sourceTable: string | undefined;
    let sourceLine: number | undefined;
    let sourceColumn: number | undefined;

    for (let offset = 0; offset < parsedBlock.lines.length; offset++) {
        const line = parsedBlock.lines[offset];
        const letMatch = line.match(/^\s*let\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)/i);
        if (letMatch) {
            const binding = allLetBindings.get(letMatch[1].toLowerCase());
            if (binding) {
                ownLetBindings.push(binding);
            }
            continue;
        }

        const sourceMatch = line.match(/^\s*([A-Za-z_]\w*)\b/);
        if (sourceMatch) {
            sourceName = sourceMatch[1];
            sourceLine = parsedBlock.startLine + offset;
            sourceColumn = line.indexOf(sourceName);
            sourceTable = resolveSourceTable(sourceName, allLetBindings, schema);
            break;
        }
    }

    let currentTables = sourceTable ? [sourceTable] : [];
    let currentColumns = columnsForTables(currentTables, schema);
    const steps: QueryStep[] = [];

    for (const pipe of parsedBlock.pipes) {
        const inputTables = [...currentTables];
        const inputColumns = [...currentColumns];
        const analyzed = analyzeStep(pipe, inputTables, inputColumns, schema);
        currentTables = analyzed.outputTables;
        currentColumns = analyzed.outputColumns;
        steps.push(analyzed);
    }

    return {
        startLine: parsedBlock.startLine,
        endLine: parsedBlock.endLine,
        sourceName,
        sourceTable,
        sourceLine,
        sourceColumn,
        letBindings: ownLetBindings,
        steps
    };
}

function analyzeStep(
    pipe: ParsedPipe,
    inputTables: string[],
    inputColumns: string[],
    schema?: QuerySchemaProvider
): QueryStep {
    const referencedColumns: ColumnReference[] = [];
    const definedColumns: ColumnReference[] = [];
    const removedColumns: ColumnReference[] = [];
    let outputTables = [...inputTables];
    let outputColumns = [...inputColumns];
    let join: JoinInfo | undefined;

    const addRefs = (refs: ColumnReference[]): void => {
        referencedColumns.push(...refs.filter(ref => !isBuiltin(ref.name)));
    };

    switch (pipe.operator) {
        case 'where':
            addRefs(extractIdentifiers(pipe.args, pipe.line, pipe.column));
            break;
        case 'extend':
            for (const assignment of extractAssignments(pipe.args, pipe.line, pipe.column)) {
                definedColumns.push(assignment.left);
                addRefs(extractIdentifiers(assignment.right, pipe.line, assignment.rightColumn));
                outputColumns = unique([...outputColumns, assignment.left.name]);
            }
            break;
        case 'project':
            outputColumns = [];
            for (const item of splitCommaList(pipe.args)) {
                const assignment = parseAssignment(item.text, pipe.line, pipe.column + item.column);
                if (assignment) {
                    definedColumns.push(assignment.left);
                    addRefs(extractIdentifiers(assignment.right, pipe.line, assignment.rightColumn));
                    outputColumns.push(assignment.left.name);
                } else {
                    const refs = extractIdentifiers(item.text, pipe.line, pipe.column + item.column);
                    addRefs(refs);
                    if (refs[0]) {
                        outputColumns.push(refs[0].name);
                    }
                }
            }
            outputColumns = unique(outputColumns);
            break;
        case 'project-away':
            removedColumns.push(...extractIdentifiers(pipe.args, pipe.line, pipe.column));
            addRefs(removedColumns);
            outputColumns = outputColumns.filter(column =>
                !removedColumns.some(removed => equalsIgnoreCase(removed.name, column))
            );
            break;
        case 'summarize': {
            const byIndex = pipe.args.search(/\bby\b/i);
            const aggregateText = byIndex === -1 ? pipe.args : pipe.args.substring(0, byIndex);
            const byText = byIndex === -1 ? '' : pipe.args.substring(byIndex + 2);
            const aggregateColumns: string[] = [];
            for (const item of splitCommaList(aggregateText)) {
                const assignment = parseAssignment(item.text, pipe.line, pipe.column + item.column);
                if (assignment) {
                    definedColumns.push(assignment.left);
                    aggregateColumns.push(assignment.left.name);
                    addRefs(extractIdentifiers(assignment.right, pipe.line, assignment.rightColumn));
                } else if (/\bcount\s*\(\s*\)/i.test(item.text)) {
                    aggregateColumns.push('count_');
                } else {
                    addRefs(extractIdentifiers(item.text, pipe.line, pipe.column + item.column));
                }
            }
            const byRefs = extractIdentifiers(byText, pipe.line, pipe.column + Math.max(byIndex + 2, 0));
            addRefs(byRefs);
            outputColumns = unique([...aggregateColumns, ...byRefs.map(ref => ref.name)]);
            outputTables = [];
            break;
        }
        case 'order':
        case 'sort': {
            const byText = pipe.args.replace(/^by\b/i, '');
            addRefs(extractIdentifiers(byText, pipe.line, pipe.column));
            break;
        }
        case 'mv-expand':
            for (const item of splitCommaList(pipe.args)) {
                const assignment = parseAssignment(item.text, pipe.line, pipe.column + item.column);
                if (assignment) {
                    definedColumns.push(assignment.left);
                    addRefs(extractIdentifiers(assignment.right, pipe.line, assignment.rightColumn));
                    outputColumns = unique([...outputColumns, assignment.left.name]);
                } else {
                    addRefs(extractIdentifiers(item.text, pipe.line, pipe.column + item.column));
                }
            }
            break;
        case 'join': {
            join = parseJoin(pipe, schema);
            if (join.rightTable) {
                outputTables = unique([...outputTables, join.rightTable]);
                outputColumns = unique([...outputColumns, ...columnsForTables([join.rightTable], schema)]);
            }
            referencedColumns.push(...join.keys);
            break;
        }
        default:
            addRefs(extractIdentifiers(pipe.args, pipe.line, pipe.column));
            break;
    }

    return {
        operator: pipe.operator,
        args: pipe.args,
        line: pipe.line,
        column: pipe.column,
        inputTables,
        outputTables,
        inputColumns,
        outputColumns,
        referencedColumns,
        definedColumns,
        removedColumns,
        join
    };
}

function parseJoin(pipe: ParsedPipe, schema?: QuerySchemaProvider): JoinInfo {
    const rightTableMatch = pipe.args.match(/\(\s*([A-Za-z_]\w*)/);
    const rightTable = rightTableMatch ? canonicalTable(rightTableMatch[1], schema) : undefined;
    const onIndex = pipe.args.search(/\bon\b/i);
    const onText = onIndex === -1 ? '' : pipe.args.substring(onIndex + 2);
    const keys: ColumnReference[] = [];

    for (const equality of onText.matchAll(/(?:\$left\.|\$right\.)?([A-Za-z_]\w*)\s*==\s*(?:\$left\.|\$right\.)?([A-Za-z_]\w*)/g)) {
        const leftIndex = onIndex + 2 + equality.index + equality[0].indexOf(equality[1]);
        const rightIndex = onIndex + 2 + equality.index + equality[0].lastIndexOf(equality[2]);
        const leftPosition = positionInPipeArgs(pipe, leftIndex);
        const rightPosition = positionInPipeArgs(pipe, rightIndex);
        keys.push({
            name: equality[1],
            line: leftPosition.line,
            column: leftPosition.column
        });
        keys.push({
            name: equality[2],
            line: rightPosition.line,
            column: rightPosition.column
        });
    }

    if (keys.length === 0 && onText.trim()) {
        keys.push(...extractIdentifiers(onText, pipe.line, pipe.column + onIndex + 2));
    }

    return {
        line: pipe.line,
        column: pipe.column,
        rightTable,
        keys
    };
}

function positionInPipeArgs(pipe: ParsedPipe, argIndex: number): { line: number; column: number } {
    const before = pipe.args.substring(0, Math.max(argIndex, 0));
    const lineBreaks = before.split('\n');
    if (lineBreaks.length === 1) {
        return {
            line: pipe.line,
            column: pipe.column + pipe.operator.length + 1 + argIndex
        };
    }
    return {
        line: pipe.line + lineBreaks.length - 1,
        column: lineBreaks[lineBreaks.length - 1].length
    };
}

function resolveSourceTable(
    sourceName: string,
    letBindings: Map<string, LetBinding>,
    schema?: QuerySchemaProvider
): string | undefined {
    const table = canonicalTable(sourceName, schema);
    if (table) {
        return table;
    }
    return letBindings.get(sourceName.toLowerCase())?.sourceTable;
}

function canonicalTable(name: string, schema?: QuerySchemaProvider): string | undefined {
    if (!schema) {
        return name;
    }
    return schema.getCanonicalTableName(name) ?? (schema.validateTableExists(name) ? name : undefined);
}

function columnsForTables(tables: string[], schema?: QuerySchemaProvider): string[] {
    if (!schema) {
        return [];
    }
    return unique(tables.flatMap(table => schema.getColumns(table)));
}

function extractAssignments(text: string, line: number, baseColumn: number): Array<{ left: ColumnReference; right: string; rightColumn: number }> {
    return splitCommaList(text)
        .map(item => parseAssignment(item.text, line, baseColumn + item.column))
        .filter((item): item is { left: ColumnReference; right: string; rightColumn: number } => Boolean(item));
}

function parseAssignment(text: string, line: number, baseColumn: number): { left: ColumnReference; right: string; rightColumn: number } | undefined {
    const match = text.match(/^\s*(?:\["([^"]+)"\]|([A-Za-z_]\w*))\s*=(?!=|~|>)/);
    if (!match) {
        return undefined;
    }
    const name = match[1] ?? match[2];
    const nameIndex = text.indexOf(match[1] ? `"${match[1]}"` : name);
    return {
        left: {
            name,
            line,
            column: baseColumn + Math.max(nameIndex, 0)
        },
        right: text.substring(match[0].length),
        rightColumn: baseColumn + match[0].length
    };
}

function extractIdentifiers(text: string, line: number, baseColumn: number): ColumnReference[] {
    const cleaned = stripStringsAndBracketedColumns(text);
    const refs: ColumnReference[] = [];
    for (const match of cleaned.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
        const name = match[1];
        if (isBuiltin(name) || /^\d/.test(name)) {
            continue;
        }
        const next = cleaned[match.index + name.length];
        if (next === '(') {
            continue;
        }
        refs.push({
            name,
            line,
            column: baseColumn + match.index
        });
    }

    for (const match of text.matchAll(/\["([^"]+)"\]/g)) {
        refs.push({
            name: match[1],
            line,
            column: baseColumn + match.index + 2
        });
    }

    return refs;
}

function stripStringsAndBracketedColumns(text: string): string {
    return text
        .replace(/@?"(?:[^"\\]|\\.)*"/g, match => ' '.repeat(match.length))
        .replace(/'(?:[^'\\]|\\.)*'/g, match => ' '.repeat(match.length))
        .replace(/\["[^"]+"\]/g, match => ' '.repeat(match.length));
}

function splitCommaList(text: string): Array<{ text: string; column: number }> {
    const parts: Array<{ text: string; column: number }> = [];
    let start = 0;
    let quote: string | undefined;
    let parenDepth = 0;
    let bracketDepth = 0;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if ((char === '"' || char === "'") && text[i - 1] !== '\\') {
            quote = quote === char ? undefined : quote ?? char;
            continue;
        }
        if (quote) {
            continue;
        }
        if (char === '(') { parenDepth++; }
        if (char === ')' && parenDepth > 0) { parenDepth--; }
        if (char === '[') { bracketDepth++; }
        if (char === ']' && bracketDepth > 0) { bracketDepth--; }
        if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
            parts.push({ text: text.substring(start, i), column: start });
            start = i + 1;
        }
    }

    parts.push({ text: text.substring(start), column: start });
    return parts.filter(part => part.text.trim() !== '');
}

function unique(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const key = value.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(value);
        }
    }
    return result;
}

function isBuiltin(word: string): boolean {
    return BUILTINS.has(word.toLowerCase());
}

function equalsIgnoreCase(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}
