export interface SyntaxError {
    line: number;
    column: number;
    length: number;
    message: string;
}

export class KqlSyntaxChecker {
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

        return errors;
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

