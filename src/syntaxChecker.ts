import { KqlSchemaValidator } from './schemaValidator';

export interface SyntaxError {
    line: number;
    column: number;
    length: number;
    message: string;
}

export class KqlSyntaxChecker {
    private schemaValidator: KqlSchemaValidator | undefined;
    // KQL keywords and operators
    private readonly keywords = new Set([
        'and', 'as', 'by', 'consume', 'count', 'distinct', 'evaluate', 'extend',
        'find', 'fork', 'getschema', 'invoke', 'join', 'limit', 'lookup', 'make-series',
        'mv-apply', 'mv-expand', 'or', 'order', 'parse', 'partition', 'print', 'project',
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
        'getmonth', 'getyear', 'hourofday', 'iff', 'indexof', 'isempty', 'isnotempty',
        'isnotnull', 'isnull', 'now', 'parse_json', 'parse_xml', 'replace', 'split',
        'startofday', 'startofmonth', 'startofweek', 'startofyear', 'strcat', 'strcat_delim',
        'strlen', 'substring', 'timespan', 'tostring', 'tolower', 'toupper', 'trim',
        'trim_end', 'trim_start', 'toint', 'tolong', 'todouble', 'todecimal', 'tobool'
    ]);

    public setSchemaValidator(validator: KqlSchemaValidator): void {
        this.schemaValidator = validator;
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
            this.checkStringLiterals(line, i, errors);
            this.checkCommonMistakes(line, i, errors, inSummarizeBlock || inExtendBlock || inProjectBlock || inLetStatement);
        }

        // Check bracket balance across the entire query
        this.checkOverallBracketBalance(text, errors);
        
        // Check overall query structure
        this.checkQueryStructure(text, errors);

        // Check table and column names against schema (if validator is available)
        if (this.schemaValidator) {
            this.checkTableAndColumns(text, errors);
        }

        return errors;
    }

    private checkTableAndColumns(text: string, errors: SyntaxError[]): void {
        const lines = text.split('\n');
        let currentTable: string | undefined;
        let joinedTables: Set<string> = new Set(); // Track all tables in current join chain
        let createdColumns: Set<string> = new Set(); // Track columns created by extend/summarize
        let hasSummarize = false; // Track if we've seen a summarize (creates new schema)
        let inMultiLineOperator = false; // Track if we're in a multi-line operator (project/summarize/extend)
        
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const trimmedLine = line.trim().toLowerCase();
            
            // Skip comments, empty lines, and markdown headers
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || !trimmedLine || trimmedLine.startsWith('#')) {
                continue;
            }
            
            // Skip let statements
            if (trimmedLine.startsWith('let ')) {
                continue;
            }
            
            // Track multi-line operators
            if (/\|\s*(?:project|summarize|extend)\b/i.test(line)) {
                inMultiLineOperator = true;
            } else if (trimmedLine.startsWith('|') && !/^\s+/.test(line)) {
                // New pipe operator resets multi-line context
                inMultiLineOperator = false;
            }
            
            // Check for table name at start of query ONLY (not continuation lines)
            // Table names must be at the start of the line (no leading whitespace) or after minimal indent
            const tableMatch = line.match(/^([^\S\r\n]{0,2})([A-Z]\w+)(\s*\||$)/);
            if (tableMatch && !inMultiLineOperator && lineNum === 0 || (tableMatch && !inMultiLineOperator && lines[lineNum - 1]?.trim() === '')) {
                const tableName = tableMatch[2];
                currentTable = tableName;
                joinedTables.clear();
                joinedTables.add(tableName);
                createdColumns.clear();
                hasSummarize = false;
                
                if (!this.schemaValidator!.validateTableExists(tableName)) {
                    const suggestion = this.schemaValidator!.suggestSimilarTable(tableName);
                    const message = suggestion 
                        ? `Unknown table '${tableName}'. Did you mean '${suggestion}'?`
                        : `Unknown table '${tableName}'`;
                    
                    errors.push({
                        line: lineNum,
                        column: tableMatch[1].length,
                        length: tableName.length,
                        message: message
                    });
                    currentTable = undefined; // Don't validate columns if table is unknown
                }
            }
            
            // Check table names after union
            const unionMatch = line.match(/union\s+([A-Z]\w+)/i);
            if (unionMatch) {
                const tableName = unionMatch[1];
                if (!this.schemaValidator!.validateTableExists(tableName)) {
                    const suggestion = this.schemaValidator!.suggestSimilarTable(tableName);
                    const message = suggestion 
                        ? `Unknown table '${tableName}'. Did you mean '${suggestion}'?`
                        : `Unknown table '${tableName}'`;
                    
                    const index = line.indexOf(tableName);
                    errors.push({
                        line: lineNum,
                        column: index,
                        length: tableName.length,
                        message: message
                    });
                }
            }
            
            // Track join operations - adds columns from the joined table
            const joinMatch = line.match(/\|\s*join\s+(?:kind\s*=\s*\w+\s+)?\(?(\w+)\)?/i);
            if (joinMatch) {
                const joinedTableName = joinMatch[1];
                // Check if it's a valid table (not a keyword like 'kind')
                if (this.schemaValidator!.validateTableExists(joinedTableName)) {
                    joinedTables.add(joinedTableName);
                }
            }
            
            // Track columns created by extend: | extend NewCol = ...
            if (/\|\s*extend\b/i.test(line)) {
                const extendMatches = line.matchAll(/extend\s+([A-Z_]\w*)\s*=/gi);
                for (const match of extendMatches) {
                    createdColumns.add(match[1]);
                }
            }
            
            // Track if we hit a summarize - this creates entirely new columns
            if (/\|\s*summarize\b/i.test(line)) {
                hasSummarize = true;
                // Extract new column names from summarize: ColumnName = aggregation()
                const summarizeMatches = line.matchAll(/([A-Z_]\w*)\s*=\s*\w+\(/gi);
                for (const match of summarizeMatches) {
                    createdColumns.add(match[1]);
                }
            }
            
            // Validate columns if we know the current table
            if (currentTable && this.schemaValidator!.validateTableExists(currentTable)) {
                this.validateColumnsInLine(line, lineNum, currentTable, joinedTables, createdColumns, hasSummarize, errors);
            }
        }
    }

    private validateColumnsInLine(line: string, lineNum: number, tableName: string, joinedTables: Set<string>, createdColumns: Set<string>, hasSummarize: boolean, errors: SyntaxError[]): void {
        // Skip if line has comments
        let cleanLine = line;
        if (line.includes('//')) {
            cleanLine = line.substring(0, line.indexOf('//'));
        }
        
        // Check for specific operators where we validate columns
        const hasWhere = /\|\s*where\b/i.test(cleanLine);
        const hasProject = /\|\s*project(?:-\w+)?\b/i.test(cleanLine);
        const hasLocalSummarize = /\|\s*summarize\b/i.test(cleanLine);
        const hasOrderBy = /\|\s*(?:order|sort)\s+by\b/i.test(cleanLine);
        const hasExtend = /\|\s*extend\b/i.test(cleanLine);
        
        // If line starts with just whitespace and identifiers (likely continuation of project/summarize)
        const isContinuationLine = /^\s+[A-Z_]\w*\s*[,\s]*$/i.test(cleanLine);
        
        if (hasWhere) {
            // Validate columns in where clause: where ColumnName ==, !=, <, >, etc.
            const wherePattern = /\bwhere\s+([A-Z_]\w*)\s*(?:[=!<>]|contains|has|startswith|endswith)/gi;
            this.validateColumnsWithPattern(cleanLine, wherePattern, line, lineNum, joinedTables, createdColumns, errors);
        }
        
        if (hasProject || isContinuationLine) {
            // Validate all column-like identifiers in project statements
            // Match identifiers that are: start of word, optional comma before, optional comma/whitespace after
            const projectPattern = /\b([A-Z_]\w*)(?:\s*[,\s]|$)/gi;
            this.validateColumnsWithPattern(cleanLine, projectPattern, line, lineNum, joinedTables, createdColumns, errors);
        }
        
        if (hasExtend) {
            // In extend, validate columns on the right side of =
            const extendPattern = /=\s*([A-Z_]\w*)/gi;
            this.validateColumnsWithPattern(cleanLine, extendPattern, line, lineNum, joinedTables, createdColumns, errors);
        }
        
        if (hasLocalSummarize) {
            // Validate columns after 'by' keyword in summarize
            const byPattern = /\bby\s+([A-Z_]\w*)/gi;
            this.validateColumnsWithPattern(cleanLine, byPattern, line, lineNum, joinedTables, createdColumns, errors);
        }
        
        if (hasOrderBy) {
            // For sort/order by after summarize, skip validation since columns are newly created
            if (!hasSummarize) {
                // Only validate if we haven't seen a summarize yet
                const byPattern = /\bby\s+([A-Z_]\w*)/gi;
                this.validateColumnsWithPattern(cleanLine, byPattern, line, lineNum, joinedTables, createdColumns, errors);
            }
            // If after summarize, don't validate - those are aggregated columns
        }
    }
    
    private validateColumnsWithPattern(cleanLine: string, pattern: RegExp, originalLine: string, lineNum: number, joinedTables: Set<string>, createdColumns: Set<string>, errors: SyntaxError[]): void {
        const matches = cleanLine.matchAll(pattern);
        for (const match of matches) {
            const columnName = match[1];
            
            if (!columnName) continue;
            
            // Skip if it's a keyword, function, or operator
            if (this.isKqlKeywordOrFunction(columnName)) {
                continue;
            }
            
            // Skip common table names (might be in extend statements)
            if (this.schemaValidator!.validateTableExists(columnName)) {
                continue;
            }
            
            // Skip if this column was created by extend or summarize
            if (createdColumns.has(columnName)) {
                continue;
            }
            
            // Check if column exists in ANY of the joined tables
            let columnFound = false;
            let foundInTable = '';
            
            for (const tableName of joinedTables) {
                if (this.schemaValidator!.validateColumn(tableName, columnName)) {
                    columnFound = true;
                    foundInTable = tableName;
                    break;
                }
            }
            
            // If column not found in any table, report error
            if (!columnFound) {
                // Try to find similar column in the primary table (first in set)
                const primaryTable = Array.from(joinedTables)[0];
                const similarColumn = this.findSimilarColumn(primaryTable, columnName);
                
                const tableList = joinedTables.size > 1 
                    ? `tables '${Array.from(joinedTables).join(', ')}'`
                    : `table '${primaryTable}'`;
                
                const message = similarColumn
                    ? `Unknown column '${columnName}' in ${tableList}. Did you mean '${similarColumn}'?`
                    : `Unknown column '${columnName}' in ${tableList}`;
                
                const columnIndex = originalLine.indexOf(columnName);
                if (columnIndex !== -1) {
                    errors.push({
                        line: lineNum,
                        column: columnIndex,
                        length: columnName.length,
                        message: message
                    });
                }
            }
        }
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

    private checkBracketBalance(line: string, lineNum: number, errors: SyntaxError[]): void {
        let parenCount = 0;
        let bracketCount = 0;
        let braceCount = 0;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            // Skip string literals
            if (char === '"' || char === "'") {
                i = this.skipString(line, i);
                continue;
            }

            switch (char) {
                case '(': parenCount++; break;
                case ')': parenCount--; break;
                case '[': bracketCount++; break;
                case ']': bracketCount--; break;
                case '{': braceCount++; break;
                case '}': braceCount--; break;
            }

            if (parenCount < 0) {
                errors.push({
                    line: lineNum,
                    column: i,
                    length: 1,
                    message: 'Unmatched closing parenthesis'
                });
            }
            if (bracketCount < 0) {
                errors.push({
                    line: lineNum,
                    column: i,
                    length: 1,
                    message: 'Unmatched closing bracket'
                });
            }
            if (braceCount < 0) {
                errors.push({
                    line: lineNum,
                    column: i,
                    length: 1,
                    message: 'Unmatched closing brace'
                });
            }
        }

        if (parenCount > 0) {
            errors.push({
                line: lineNum,
                column: line.length - 1,
                length: 1,
                message: 'Unclosed parenthesis'
            });
        }
        if (bracketCount > 0) {
            errors.push({
                line: lineNum,
                column: line.length - 1,
                length: 1,
                message: 'Unclosed bracket'
            });
        }
        if (braceCount > 0) {
            errors.push({
                line: lineNum,
                column: line.length - 1,
                length: 1,
                message: 'Unclosed brace'
            });
        }
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
        // Only flag if we're not inside a summarize/extend/project/let block
        // Exclude common parameters like kind=, on=, hint.*, etc.
        const assignmentMatch = line.match(/\b(\w+)\s*=\s*(?![=>])/);
        if (assignmentMatch) {
            const variableName = assignmentMatch[1].toLowerCase();
            // Common KQL parameters that use = syntax
            const isParameter = [
                'kind', 'on', 'hint', 'with', 'shuffle', 'broadcast', 'remote', 'local',
                'strategy', 'isfuzzy', 'flags', 'format', 'key', 'name', 'scope'
            ].includes(variableName);
            
            // Check if it starts with hint. (e.g., hint.strategy=)
            const isHintParameter = variableName.startsWith('hint');
            
            if (!isParameter && !isHintParameter && !inOperatorBlock && !trimmedLine.includes('extend') && !trimmedLine.includes('summarize') && !trimmedLine.includes('project') && !trimmedLine.includes('let')) {
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

    private skipString(line: string, start: number): number {
        const quote = line[start];
        for (let i = start + 1; i < line.length; i++) {
            if (line[i] === quote && line[i - 1] !== '\\') {
                return i;
            }
        }
        return line.length;
    }
}

