import { KqlSchemaValidator } from './schemaValidator';
import { buildQueryModel, ColumnReference, QuerySchemaProvider, QueryStep } from './queryModel';
import { LintMode, runLintRules } from './lintRules';

export type SyntaxIssueSeverity = 'error' | 'warning' | 'information';

export interface SyntaxError {
    line: number;
    column: number;
    length: number;
    message: string;
    /** When set, overrides kqlAssistant.diagnosticLevel for this issue */
    severity?: SyntaxIssueSeverity;
    /** Stable rule id (e.g. KQL101) for CI suppressions */
    code?: string;
}

export class KqlSyntaxChecker {
    private schemaValidator: QuerySchemaProvider | undefined;
    private ignoredTables = new Set<string>();
    private lintMode: LintMode = 'off';

    /** Operators that must be preceded by `|` when used as a line-leading tabular step */
    private readonly pipeRequiredOperators = [
        'project-away', 'project-keep', 'project-rename', 'project-reorder',
        'mv-expand', 'mv-apply', 'make-series',
        'where', 'project', 'extend', 'summarize', 'order', 'sort',
        'take', 'limit', 'top', 'distinct', 'count', 'render', 'join', 'lookup'
    ];

    // KQL keywords and operators
    private readonly keywords = new Set([
        'and', 'as', 'away', 'by', 'consume', 'count', 'distinct', 'evaluate', 'extend',
        'find', 'fork', 'getschema', 'invoke', 'join', 'limit', 'lookup', 'make-series',
        'mv-apply', 'mv-expand', 'on', 'or', 'order', 'parse', 'partition', 'print', 'project',
        'project-away', 'project-keep', 'project-rename', 'project-reorder', 'range',
        'reduce', 'render', 'sample', 'sample-distinct', 'scan', 'search', 'serialize',
        'sort', 'summarize', 'take', 'top', 'top-hitters', 'top-nested', 'union', 'where'
    ]);

    private readonly aggregationFunctions = new Set([
        'avg', 'avgif', 'count', 'countif', 'dcount', 'dcountif', 'make_bag', 'make_list',
        'make_set', 'max', 'maxif', 'min', 'minif', 'percentile', 'percentiles', 'stdev',
        'stdevif', 'sum', 'sumif', 'variance', 'varianceif'
    ]);

    private readonly scalarFunctions = new Set([
        'ago', 'array_length', 'bin', 'case', 'datetime', 'dayofweek', 'endofday',
        'endofmonth', 'endofweek', 'endofyear', 'extract', 'format_datetime', 'format_timespan',
        'getmonth', 'getyear', 'hourofday', 'iff', 'iif', 'indexof', 'isempty', 'isnotempty',
        'isnotnull', 'isnull', 'now', 'parse_json', 'parse_xml', 'replace', 'split',
        'startofday', 'startofmonth', 'startofweek', 'startofyear', 'strcat', 'strcat_delim',
        'strlen', 'substring', 'timespan', 'tostring', 'tolower', 'toupper', 'trim',
        'trim_end', 'trim_start', 'toint', 'tolong', 'todouble', 'todecimal', 'tobool',
        // Common functions that should be skipped in column validation
        'coalesce', 'pack', 'pack_all', 'bag_pack', 'dynamic', 'parse_url', 'parse_urlquery',
        'parse_path', 'parse_user_agent', 'parse_version', 'parse_csv', 'hash', 'hash_sha256',
        'hash_md5', 'base64_encode_tostring', 'base64_decode_tostring', 'url_encode', 'url_decode',
        'geo_distance_2points', 'geo_point_in_circle', 'ipv4_is_private', 'ipv4_is_in_range',
        'array_concat', 'array_slice', 'array_index_of', 'array_sum', 'bag_keys', 'bag_merge',
        'row_number', 'row_rank', 'prev', 'next', 'todynamic', 'toguid', 'totimespan',
        'format_bytes', 'format_ipv4', 'format_ipv4_mask', 'has_any_ipv4', 'has_any_ipv4_prefix',
        'ipv4_compare', 'ipv4_is_match', 'ipv6_compare', 'ipv6_is_match', 'parse_ipv4', 'parse_ipv6',
        'translate', 'reverse', 'repeat', 'replace_regex', 'replace_string', 'replace_strings',
        'trim_regex', 'unicode_codepoints_from_string', 'unicode_codepoints_to_string',
        'weekofyear', 'monthofyear', 'dayofyear', 'datetime_add', 'datetime_diff', 'datetime_part',
        'make_datetime', 'make_timespan', 'todatetime', 'unixtime_microseconds_todatetime',
        'unixtime_milliseconds_todatetime', 'unixtime_nanoseconds_todatetime', 'unixtime_seconds_todatetime'
    ]);

    public setSchemaValidator(validator: KqlSchemaValidator | QuerySchemaProvider): void {
        this.schemaValidator = validator;
    }

    /** Table names that should not produce "Unknown table" diagnostics (case-insensitive). */
    public setIgnoredTables(tables: string[]): void {
        this.ignoredTables = new Set(
            tables
                .map(t => t.trim().toLowerCase())
                .filter(t => t.length > 0)
        );
    }

    /** Detection / cost lint pack: off | basic | strict */
    public setLintMode(mode: LintMode): void {
        this.lintMode = mode;
    }

    public check(text: string): SyntaxError[] {
        const errors: SyntaxError[] = [];
        const lines = text.split('\n');
        
        // Track context across lines
        let inSummarizeBlock = false;
        let inExtendBlock = false;
        let inProjectBlock = false;
        let inLetStatement = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            const lowerLine = trimmedLine.toLowerCase();

            // Skip empty lines and comments
            if (trimmedLine === '' || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
                continue;
            }

            // Check if this is a let statement
            if (lowerLine.startsWith('let ')) {
                inLetStatement = true;
                // Reset other contexts
                inSummarizeBlock = false;
                inExtendBlock = false;
                inProjectBlock = false;
            }
            
            // Let statements end with semicolon
            if (inLetStatement && trimmedLine.endsWith(';')) {
                inLetStatement = false;
            }

            // Track if we're entering an operator block
            if (lowerLine.includes('| summarize')) {
                inSummarizeBlock = true;
                inExtendBlock = false;
                inProjectBlock = false;
                inLetStatement = false;
            } else if (lowerLine.includes('| extend')) {
                inExtendBlock = true;
                inSummarizeBlock = false;
                inProjectBlock = false;
                inLetStatement = false;
            } else if (lowerLine.includes('| project')) {
                inProjectBlock = true;
                inSummarizeBlock = false;
                inExtendBlock = false;
                inLetStatement = false;
            } else if (lowerLine.startsWith('|') && !lowerLine.startsWith('| ') && lowerLine.length > 1) {
                // Reset context when we hit a new pipe operator (but not standalone |)
                inSummarizeBlock = false;
                inExtendBlock = false;
                inProjectBlock = false;
            } else if (lowerLine.startsWith('| ')) {
                // Check if this is a new operator
                const pipeOperator = lowerLine.match(/^\|\s+(\w+)/);
                if (pipeOperator && !['by'].includes(pipeOperator[1])) {
                    // Reset context for new operators (except 'by' which continues the block)
                    const operator = pipeOperator[1];
                    if (!['summarize', 'extend', 'project'].includes(operator)) {
                        inSummarizeBlock = false;
                        inExtendBlock = false;
                        inProjectBlock = false;
                    }
                }
            }

            // Check for common syntax errors (not bracket balance per line)
            this.checkPipeOperator(line, i, errors);
            this.checkMissingPipeOperator(line, i, errors);
            this.checkStringLiterals(line, i, errors);
            this.checkCommonMistakes(line, i, errors, inSummarizeBlock || inExtendBlock || inProjectBlock || inLetStatement);
        }

        // Check bracket balance across the entire query
        this.checkOverallBracketBalance(text, errors);
        
        // Check overall query structure
        this.checkQueryStructure(text, errors);

        // Check table and column names against schema (if validator is available)
        if (this.schemaValidator) {
            this.checkTableAndColumnsWithModel(text, errors);
        }

        errors.push(...runLintRules(text, { mode: this.lintMode }));

        return errors;
    }

    private checkTableAndColumnsWithModel(text: string, errors: SyntaxError[]): void {
        const model = buildQueryModel(text, this.schemaValidator);

        for (const issue of model.parseIssues) {
            errors.push(issue);
        }

        for (const block of model.blocks) {
            if (
                block.sourceName &&
                !block.sourceTable &&
                !block.sourceColumns?.length &&
                /^[A-Z]\w*/.test(block.sourceName)
            ) {
                if (this.ignoredTables.has(block.sourceName.toLowerCase())) {
                    continue;
                }
                const suggestion = this.schemaValidator!.suggestSimilarTable(block.sourceName);
                errors.push({
                    line: block.sourceLine ?? block.startLine,
                    column: block.sourceColumn ?? 0,
                    length: block.sourceName.length,
                    message: suggestion
                        ? `Unknown table '${block.sourceName}'. Did you mean '${suggestion}'?`
                        : `Unknown table '${block.sourceName}'`
                });
                continue;
            }

            for (const step of block.steps) {
                const validColumns = this.getValidColumnsForStep(step);
                for (const reference of step.referencedColumns) {
                    this.validateColumnReference(reference, validColumns, step, errors);
                }

                for (const removed of step.removedColumns) {
                    this.validateColumnReference(removed, step.inputColumns, step, errors);
                }
            }
        }
    }

    private getValidColumnsForStep(step: QueryStep): string[] {
        if ((step.operator === 'join' || step.operator === 'lookup') && step.join?.rightTable) {
            return [
                ...step.inputColumns,
                ...this.schemaValidator!.getColumns(step.join.rightTable)
            ];
        }
        return step.inputColumns;
    }

    private validateColumnReference(
        reference: ColumnReference,
        validColumns: string[],
        step: QueryStep,
        errors: SyntaxError[]
    ): void {
        if (this.isKqlKeywordOrFunction(reference.name)) {
            return;
        }
        if (this.schemaValidator!.validateTableExists(reference.name)) {
            return;
        }
        if (validColumns.some(column => column.toLowerCase() === reference.name.toLowerCase())) {
            return;
        }

        const primaryTable = step.inputTables[0] ?? step.outputTables[0];
        const similarColumn = primaryTable ? this.findSimilarColumn(primaryTable, reference.name) : undefined;
        const tableList = step.inputTables.length > 1
            ? `tables '${step.inputTables.join(', ')}'`
            : primaryTable
                ? `table '${primaryTable}'`
                : 'current query scope';

        errors.push({
            line: reference.line,
            column: reference.column,
            length: reference.name.length,
            message:
                step.operator === 'join' || step.operator === 'lookup'
                ? `${step.operator === 'lookup' ? 'Lookup' : 'Join'} key column '${reference.name}' not found in joined tables`
                : similarColumn
                ? `Unknown column '${reference.name}' in ${tableList}. Did you mean '${similarColumn}'?`
                : `Unknown column '${reference.name}' in ${tableList}`
        });
    }

    private findSimilarColumn(tableName: string, columnName: string): string | undefined {
        const columns = this.schemaValidator!.getColumns(tableName);
        const lowerName = columnName.toLowerCase();
        let bestMatch: string | undefined;
        let minDistance = Infinity;
        
        for (const col of columns) {
            // Check for simple typos (1-2 character difference)
            const distance = this.levenshteinDistance(lowerName, col.toLowerCase());
            if (distance < minDistance && distance <= 2) {
                minDistance = distance;
                bestMatch = col;
            }
        }
        
        return bestMatch;
    }

    private isKqlKeywordOrFunction(word: string): boolean {
        const lower = word.toLowerCase();
        return this.keywords.has(lower) || 
               this.aggregationFunctions.has(lower) || 
               this.scalarFunctions.has(lower) ||
               ['bin', 'ago', 'now', 'datetime', 'timespan', 'case', 'iff'].includes(lower);
    }

    private levenshteinDistance(a: string, b: string): number {
        const matrix: number[][] = [];
        
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[b.length][a.length];
    }

    private checkPipeOperator(line: string, lineNum: number, errors: SyntaxError[]): void {
        const trimmedLine = line.trim();

        // Check for pipe at the start (except for continuation)
        if (trimmedLine.startsWith('|') && lineNum === 0) {
            errors.push({
                line: lineNum,
                column: line.indexOf('|'),
                length: 1,
                message: 'Query cannot start with pipe operator'
            });
        }

        // Check for double pipes
        if (line.includes('||') && !line.includes('or')) {
            const index = line.indexOf('||');
            errors.push({
                line: lineNum,
                column: index,
                length: 2,
                message: 'Double pipe operator - use single | to chain operators'
            });
        }
    }

    private checkMissingPipeOperator(line: string, lineNum: number, errors: SyntaxError[]): void {
        const trimmedLine = line.trim();
        if (
            trimmedLine === '' ||
            trimmedLine.startsWith('|') ||
            trimmedLine.startsWith('//') ||
            trimmedLine.startsWith('/*') ||
            /^#{1,6}\s+/.test(trimmedLine) ||
            trimmedLine.toLowerCase().startsWith('let ')
        ) {
            return;
        }

        const lower = trimmedLine.toLowerCase();
        for (const op of this.pipeRequiredOperators) {
            if (lower === op || lower.startsWith(op + ' ') || lower.startsWith(op + '\t')) {
                const startCol = line.search(/\S/);
                errors.push({
                    line: lineNum,
                    column: startCol >= 0 ? startCol : 0,
                    length: op.length,
                    message: `Missing pipe operator before '${op}'`
                });
                return;
            }
        }
    }

    private checkStringLiterals(line: string, lineNum: number, errors: SyntaxError[]): void {
        let inString = false;
        let stringChar = '';
        let stringStart = 0;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (!inString && (char === '"' || char === "'")) {
                inString = true;
                stringChar = char;
                stringStart = i;
            } else if (inString && char === stringChar && line[i - 1] !== '\\') {
                inString = false;
            }
        }

        if (inString) {
            errors.push({
                line: lineNum,
                column: stringStart,
                length: 1,
                message: 'Unclosed string literal'
            });
        }
    }

    private checkCommonMistakes(line: string, lineNum: number, errors: SyntaxError[], inOperatorBlock: boolean): void {
        const trimmedLine = line.trim().toLowerCase();

        // Skip markdown headers (lines that start with # and end with # or just have #)
        const isMarkdownHeader = /^#{1,6}\s+.*/.test(trimmedLine);
        if (isMarkdownHeader) {
            return;
        }

        // Check for common SQL keywords used incorrectly
        if (trimmedLine.includes('select ') && !trimmedLine.includes('//')) {
            const index = line.toLowerCase().indexOf('select');
            errors.push({
                line: lineNum,
                column: index,
                length: 6,
                message: 'KQL uses "project" instead of "select"'
            });
        }

        if (trimmedLine.includes('from ') && !trimmedLine.includes('//')) {
            const match = trimmedLine.match(/\bfrom\s+/);
            if (match) {
                const index = line.toLowerCase().indexOf(match[0]);
                errors.push({
                    line: lineNum,
                    column: index,
                    length: 4,
                    message: 'KQL starts with table name, no "from" keyword needed'
                });
            }
        }

        // Check for assignment without proper operator
        // Only flag if we're not inside a summarize/extend/project/let/mv-expand block
        // Exclude common parameters like kind=, on=, hint.*, withsource=, etc.
        // Also exclude comparison operators: =~, ==, !=, !~
        const assignmentMatch = line.match(/\b(\w+)\s*=(?![=~>])\s*/);
        if (assignmentMatch) {
            const variableName = assignmentMatch[1].toLowerCase();
            
            // Skip if preceded by !, which would be != or !~ operator
            const matchIndex = line.indexOf(assignmentMatch[0]);
            if (matchIndex > 0 && line[matchIndex - 1] === '!') {
                return; // This is != or !~, not an assignment
            }
            
            // Common KQL parameters that use = syntax
            const isParameter = [
                'kind', 'on', 'hint', 'with', 'shuffle', 'broadcast', 'remote', 'local',
                'strategy', 'isfuzzy', 'flags', 'format', 'key', 'name', 'scope',
                'withsource', 'isFuzzy', 'default', 'step', 'from', 'to'
            ].includes(variableName);
            
            // Check if it starts with hint. (e.g., hint.strategy=)
            const isHintParameter = variableName.startsWith('hint');
            
            // Check if we're in a union statement (has parameters like withsource=)
            const isUnionLine = trimmedLine.includes('union');
            
            // Check if we're in an mv-expand, mv-apply, or lookup statement
            const isMvOperator = trimmedLine.includes('mv-expand') || trimmedLine.includes('mv-apply') || trimmedLine.includes('lookup');
            
            if (!isParameter && !isHintParameter && !inOperatorBlock && !isMvOperator && !isUnionLine && !trimmedLine.includes('extend') && !trimmedLine.includes('summarize') && !trimmedLine.includes('project') && !trimmedLine.includes('let')) {
                const index = line.indexOf(assignmentMatch[0]);
                errors.push({
                    line: lineNum,
                    column: index,
                    length: assignmentMatch[0].length,
                    message: 'Assignment requires extend, summarize, project, or let statement'
                });
            }
        }
    }

    private checkOverallBracketBalance(text: string, errors: SyntaxError[]): void {
        let parenCount = 0;
        let bracketCount = 0;
        let braceCount = 0;
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            // Track string literals to skip brackets inside strings
            if (!inString && (char === '"' || char === "'")) {
                inString = true;
                stringChar = char;
            } else if (inString && char === stringChar && (i === 0 || text[i - 1] !== '\\')) {
                inString = false;
            }

            // Skip brackets inside strings
            if (inString) {
                continue;
            }

            // Count brackets
            if (char === '(') parenCount++;
            if (char === ')') parenCount--;
            if (char === '[') bracketCount++;
            if (char === ']') bracketCount--;
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
        }

        // Report overall imbalance (just on the first line for simplicity)
        if (parenCount !== 0) {
            errors.push({
                line: 0,
                column: 0,
                length: 1,
                message: parenCount > 0 ? 'Unclosed parenthesis in query' : 'Unmatched closing parenthesis in query'
            });
        }
        if (bracketCount !== 0) {
            errors.push({
                line: 0,
                column: 0,
                length: 1,
                message: bracketCount > 0 ? 'Unclosed bracket in query' : 'Unmatched closing bracket in query'
            });
        }
        if (braceCount !== 0) {
            errors.push({
                line: 0,
                column: 0,
                length: 1,
                message: braceCount > 0 ? 'Unclosed brace in query' : 'Unmatched closing brace in query'
            });
        }
    }

    private checkQueryStructure(text: string, errors: SyntaxError[]): void {
        const lines = text.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed !== '' && !trimmed.startsWith('//');
        });

        if (lines.length === 0) {
            return;
        }

        const firstLine = lines[0].trim();
        
        // Check if query starts with a valid table name or keyword
        if (firstLine.startsWith('|')) {
            errors.push({
                line: 0,
                column: 0,
                length: 1,
                message: 'Query must start with a table name or valid KQL command'
            });
        }
    }

}

