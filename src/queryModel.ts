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
    /** Columns from datatable(...) IOC lists */
    columns?: string[];
    line: number;
    column?: number;
}

export interface JoinInfo {
    line: number;
    column: number;
    rightTable?: string;
    keys: ColumnReference[];
    /** Columns produced by the right-hand subquery (table schema or project/summarize output). */
    subqueryColumns: string[];
    innerModel?: QueryModel;
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
    /** Initial columns when source is datatable / let-bound IOC list (not a schema table) */
    sourceColumns?: string[];
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
    'has_any', 'has_all', 'has_cs', 'contains_cs', 'startswith_cs', 'endswith_cs', 'matches',
    'iff', 'iif', 'case', 'tostring', 'toint', 'tolong', 'todouble', 'todatetime', 'dynamic',
    'parse_json', 'extract', 'format_datetime', 'project', 'extend', 'summarize', 'where',
    'join', 'union', 'mv-expand', 'lookup', 'project-away', 'project-keep', 'project-rename',
    'order', 'sort', 'take', 'limit', 'render', 'datatable', 'columnchart', 'timechart',
    'barchart', 'piechart', 'scatterchart', 'areachart', 'linechart', 'anomalychart',
    'simple', 'relaxed', 'flags', 'materialize', 'invoke', 'fork', 'hint'
]);

/** Sentinel watchlist tabular function — extra columns are workspace-specific. */
export const WATCHLIST_COLUMNS = ['SearchKey', 'LastUpdated', '*'];

/** Marks a scope where unknown columns should not be flagged (bag_unpack / watchlist extras). */
export const OPEN_COLUMN = '*';

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
        columns: block.sourceColumns ?? []
    };
}

function collectLetBindings(blocks: ParsedQueryBlock[], schema?: QuerySchemaProvider): Map<string, LetBinding> {
    const bindings = new Map<string, LetBinding>();
    for (const block of blocks) {
        for (let offset = 0; offset < block.lines.length; offset++) {
            const line = block.lines[offset];
            const letMatch = line.match(/^\s*let\s+([A-Za-z_]\w*)\s*=/i);
            if (!letMatch) {
                continue;
            }

            const name = letMatch[1];
            const lineNumber = block.startLine + offset;
            const nameColumn = Math.max(0, line.toLowerCase().indexOf(name.toLowerCase()));
            const datatableMatch = line.match(
                /^\s*let\s+[A-Za-z_]\w*\s*=\s*datatable\s*\(([^)]*)\)/i
            );
            if (datatableMatch) {
                bindings.set(name.toLowerCase(), {
                    name,
                    columns: parseDatatableColumns(datatableMatch[1]),
                    line: lineNumber,
                    column: nameColumn
                });
                continue;
            }

            if (/=\s*_GetWatchlist\s*\(/i.test(line)) {
                bindings.set(name.toLowerCase(), {
                    name,
                    columns: [...WATCHLIST_COLUMNS],
                    line: lineNumber,
                    column: nameColumn
                });
                continue;
            }

            const tableMatch = line.match(/^\s*let\s+[A-Za-z_]\w*\s*=\s*([A-Za-z_]\w*)/i);
            const rhsName = tableMatch?.[1];
            const skipTableNames = new Set(['datatable', 'dynamic', 'datetime', 'timespan', 'guid', 'materialize']);
            const sourceTable =
                rhsName && !skipTableNames.has(rhsName.toLowerCase())
                    ? canonicalTable(rhsName, schema)
                    : undefined;

            bindings.set(name.toLowerCase(), {
                name,
                sourceTable,
                line: lineNumber,
                column: nameColumn
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
    let sourceColumns: string[] | undefined;
    let sourceLine: number | undefined;
    let sourceColumn: number | undefined;
    let unionTables: string[] | undefined;

    for (let offset = 0; offset < parsedBlock.lines.length; offset++) {
        const line = parsedBlock.lines[offset];
        const letMatch = line.match(/^\s*let\s+([A-Za-z_]\w*)\s*=/i);
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

            if (sourceName.toLowerCase() === 'datatable') {
                sourceColumns = parseDatatableColumnsFromBlock(parsedBlock);
            } else if (sourceName.toLowerCase() === 'union') {
                const unionInfo = parseUnionSource(line, schema);
                unionTables = unionInfo.tables;
                sourceTable = unionInfo.tables[0];
                sourceColumns = unique([
                    ...columnsForTables(unionInfo.tables, schema),
                    ...unionInfo.extraColumns
                ]);
            } else if (sourceName.toLowerCase() === '_getwatchlist') {
                sourceColumns = [...WATCHLIST_COLUMNS];
            } else {
                const binding = allLetBindings.get(sourceName.toLowerCase());
                if (binding?.columns) {
                    sourceColumns = binding.columns;
                }
            }
            break;
        }
    }

    let currentTables = unionTables ?? (sourceTable ? [sourceTable] : []);
    let currentColumns = sourceColumns ?? columnsForTables(currentTables, schema);
    const steps: QueryStep[] = [];

    for (const pipe of parsedBlock.pipes) {
        const inputTables = [...currentTables];
        const inputColumns = [...currentColumns];
        const analyzed = analyzeStep(pipe, inputTables, inputColumns, schema, allLetBindings);
        currentTables = analyzed.outputTables;
        currentColumns = analyzed.outputColumns;
        steps.push(analyzed);
    }

    return {
        startLine: parsedBlock.startLine,
        endLine: parsedBlock.endLine,
        sourceName,
        sourceTable,
        sourceColumns,
        sourceLine,
        sourceColumn,
        // Empty lines split let statements into their own block; keep document lets in scope.
        letBindings: uniqueBindings([...allLetBindings.values(), ...ownLetBindings]),
        steps
    };
}

function analyzeStep(
    pipe: ParsedPipe,
    inputTables: string[],
    inputColumns: string[],
    schema?: QuerySchemaProvider,
    letBindings?: Map<string, LetBinding>
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
            const byBaseColumn = pipe.column + Math.max(byIndex + 2, 0);
            const byColumns: string[] = [];
            for (const item of splitCommaList(byText)) {
                const assignment = parseAssignment(item.text, pipe.line, byBaseColumn + item.column);
                if (assignment) {
                    definedColumns.push(assignment.left);
                    byColumns.push(assignment.left.name);
                    addRefs(extractIdentifiers(assignment.right, pipe.line, assignment.rightColumn));
                } else {
                    const refs = extractIdentifiers(item.text, pipe.line, byBaseColumn + item.column);
                    addRefs(refs);
                    byColumns.push(...refs.map(ref => ref.name));
                }
            }
            outputColumns = unique([...aggregateColumns, ...byColumns]);
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
        case 'parse':
        case 'parse-where': {
            const parsedColumns = extractParseColumns(pipe.args);
            addRefs(extractIdentifiers(pipe.args.replace(/\bwith\b[\s\S]*$/i, ''), pipe.line, pipe.column));
            for (const column of parsedColumns) {
                definedColumns.push({ name: column, line: pipe.line, column: pipe.column });
            }
            outputColumns = unique([...outputColumns, ...parsedColumns]);
            break;
        }
        case 'evaluate':
            addRefs(extractIdentifiers(pipe.args, pipe.line, pipe.column));
            if (/\bbag_unpack\s*\(/i.test(pipe.args)) {
                outputColumns = unique([...outputColumns, OPEN_COLUMN]);
            }
            break;
        case 'fork':
        case 'invoke':
            outputColumns = unique([...outputColumns, OPEN_COLUMN]);
            break;
        case 'project-rename':
            for (const assignment of extractAssignments(pipe.args, pipe.line, pipe.column)) {
                definedColumns.push(assignment.left);
                const oldRefs = extractIdentifiers(assignment.right, pipe.line, assignment.rightColumn);
                addRefs(oldRefs);
                const oldName = oldRefs[0]?.name;
                outputColumns = outputColumns.filter(
                    column => !oldName || !equalsIgnoreCase(column, oldName)
                );
                outputColumns = unique([...outputColumns, assignment.left.name]);
            }
            break;
        case 'union': {
            const unionInfo = parseUnionSource(pipe.args, schema);
            outputTables = unique([...outputTables, ...unionInfo.tables]);
            outputColumns = unique([
                ...outputColumns,
                ...columnsForTables(unionInfo.tables, schema),
                ...unionInfo.extraColumns
            ]);
            break;
        }
        case 'render':
            break;
        case 'join':
        case 'lookup': {
            join = parseJoin(pipe, schema, letBindings);
            if (join.rightTable) {
                outputTables = unique([...outputTables, join.rightTable]);
            }
            const rightColumns =
                join.subqueryColumns.length > 0
                    ? join.subqueryColumns
                    : join.rightTable
                      ? columnsForTables([join.rightTable], schema)
                      : [];
            outputColumns = unique([...outputColumns, ...rightColumns]);
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

function parseJoin(
    pipe: ParsedPipe,
    schema?: QuerySchemaProvider,
    letBindings?: Map<string, LetBinding>
): JoinInfo {
    const subquery = extractFirstParenGroup(pipe.args);
    let rightTable: string | undefined;
    let subqueryColumns: string[] = [];
    let innerModel: QueryModel | undefined;

    if (subquery && subquery.text.trim()) {
        innerModel = buildQueryModel(`${'\n'.repeat(pipe.line)}${subquery.text}`, schema);
        const innerBlock = innerModel.blocks[0];
        if (innerBlock) {
            rightTable = innerBlock.sourceTable;
            const lastStep = innerBlock.steps[innerBlock.steps.length - 1];
            subqueryColumns = lastStep
                ? lastStep.outputColumns
                : innerBlock.sourceColumns ?? columnsForTables(rightTable ? [rightTable] : [], schema);
        }
    }

    if (!rightTable) {
        const rightTableMatch = pipe.args.match(/\(\s*([A-Za-z_]\w*)/);
        rightTable = rightTableMatch ? canonicalTable(rightTableMatch[1], schema) : undefined;
    }

    if (!rightTable && subqueryColumns.length === 0) {
        const bareName = extractBareRightSourceName(pipe.args);
        const binding = bareName ? letBindings?.get(bareName.toLowerCase()) : undefined;
        if (binding?.columns) {
            subqueryColumns = [...binding.columns];
        } else if (bareName) {
            rightTable = binding?.sourceTable ?? canonicalTable(bareName, schema);
        }
    }

    const onIndex = findJoinOnIndex(pipe.args);
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
        keys,
        subqueryColumns,
        innerModel
    };
}

/** Source name of a join / lookup written without parentheses (`| lookup kind=leftouter Watchlist on ...`). */
function extractBareRightSourceName(args: string): string | undefined {
    const onIndex = findJoinOnIndex(args);
    const head = onIndex === -1 ? args : args.substring(0, onIndex);
    const withoutParameters = head.replace(/[\w.$]+\s*=\s*[\w.$]+/g, ' ');
    const match = withoutParameters.match(/([A-Za-z_]\w*)\s*$/);
    if (!match || isBuiltin(match[1])) {
        return undefined;
    }
    return match[1];
}

/** Index of `on` after the first top-level parenthesized subquery. */
function findJoinOnIndex(args: string): number {
    const group = extractFirstParenGroup(args);
    const searchFrom = group ? group.end : 0;
    const tail = args.substring(searchFrom);
    const match = tail.match(/\bon\b/i);
    return match && match.index !== undefined ? searchFrom + match.index : args.search(/\bon\b/i);
}

function extractFirstParenGroup(text: string): { text: string; end: number } | undefined {
    let quote: string | undefined;
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if ((char === '"' || char === "'") && text[i - 1] !== '\\') {
            quote = quote === char ? undefined : quote ?? char;
            continue;
        }
        if (quote) {
            continue;
        }
        if (char === '(') {
            if (depth === 0) {
                start = i + 1;
            }
            depth++;
        } else if (char === ')' && depth > 0) {
            depth--;
            if (depth === 0 && start >= 0) {
                return { text: text.substring(start, i), end: i + 1 };
            }
        }
    }
    return undefined;
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
    if (sourceName.toLowerCase() === 'datatable') {
        return undefined;
    }
    const table = canonicalTable(sourceName, schema);
    if (table) {
        return table;
    }
    return letBindings.get(sourceName.toLowerCase())?.sourceTable;
}

/** Parse `Col:type, Col2:type` lists from datatable(...) headers. */
export function parseDatatableColumns(header: string): string[] {
    const columns: string[] = [];
    for (const part of header.split(',')) {
        const match = part.trim().match(/^([A-Za-z_]\w*)\s*(?::|$)/);
        if (match) {
            columns.push(match[1]);
        }
    }
    return columns;
}

function parseUnionSource(
    text: string,
    schema?: QuerySchemaProvider
): { tables: string[]; extraColumns: string[] } {
    const extraColumns: string[] = [];
    const withsource = text.match(/\bwithsource\s*=\s*([A-Za-z_]\w*)/i);
    if (withsource) {
        extraColumns.push(withsource[1]);
    }

    const skip = new Set([
        'union', 'withsource', 'isfuzzy', 'true', 'false', 'kind', 'hint',
        'leftouter', 'inner', 'outer'
    ]);
    const tables: string[] = [];
    for (const match of text.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
        const name = match[1];
        if (skip.has(name.toLowerCase())) {
            continue;
        }
        const table = canonicalTable(name, schema);
        if (table) {
            tables.push(table);
        }
    }
    return { tables: unique(tables), extraColumns };
}

function parseDatatableColumnsFromBlock(block: ParsedQueryBlock): string[] {
    const text = block.lines.join('\n');
    const match = text.match(/datatable\s*\(([^)]*)\)/i);
    return match ? parseDatatableColumns(match[1]) : [];
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

function extractParseColumns(args: string): string[] {
    const withMatch = args.match(/\bwith\b/i);
    const pattern = withMatch && withMatch.index !== undefined
        ? args.slice(withMatch.index + withMatch[0].length)
        : args;
    const cleaned = stripStringsAndBracketedColumns(pattern);
    const skip = new Set([
        'string', 'int', 'long', 'real', 'double', 'bool', 'boolean', 'datetime',
        'timespan', 'guid', 'decimal', 'dynamic', 'kind', 'simple', 'regex', 'relaxed', 'flags'
    ]);
    const columns: string[] = [];
    for (const match of cleaned.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
        const name = match[1];
        if (skip.has(name.toLowerCase()) || isBuiltin(name)) {
            continue;
        }
        columns.push(name);
    }
    return unique(columns);
}

function extractIdentifiers(text: string, line: number, baseColumn: number): ColumnReference[] {
    const cleaned = stripStringsAndBracketedColumns(text);
    const refs: ColumnReference[] = [];
    for (const match of cleaned.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
        const name = match[1];
        if (isBuiltin(name) || /^\d/.test(name)) {
            continue;
        }
        if (match.index > 0 && cleaned[match.index - 1] === '.') {
            continue;
        }
        const rest = cleaned.slice(match.index + name.length);
        if (/^\s*\(/.test(rest)) {
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

function uniqueBindings(bindings: LetBinding[]): LetBinding[] {
    const seen = new Set<string>();
    const result: LetBinding[] = [];
    for (const binding of bindings) {
        const key = binding.name.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(binding);
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
