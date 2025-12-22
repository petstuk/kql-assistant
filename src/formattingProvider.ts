import * as vscode from 'vscode';

export class KqlFormattingProvider implements vscode.DocumentFormattingEditProvider {
    
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];
        const fullText = document.getText();
        const formatted = this.formatKql(fullText, options);
        
        if (formatted !== fullText) {
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(fullText.length)
            );
            edits.push(vscode.TextEdit.replace(fullRange, formatted));
        }
        
        return edits;
    }

    private formatKql(text: string, options: vscode.FormattingOptions): string {
        const lines = text.split('\n');
        const formattedLines: string[] = [];
        let inMultiLineString = false;
        let inBlockComment = false;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Handle block comments
            if (inBlockComment) {
                formattedLines.push(line);
                if (line.includes('*/')) {
                    inBlockComment = false;
                }
                continue;
            }

            if (line.includes('/*') && !line.includes('*/')) {
                formattedLines.push(line);
                inBlockComment = true;
                continue;
            }

            // Skip multi-line string literals
            const tripleQuotes = (line.match(/"""/g) || []).length;
            if (inMultiLineString) {
                formattedLines.push(line);
                if (tripleQuotes % 2 === 1) {
                    inMultiLineString = false;
                }
                continue;
            }
            if (tripleQuotes % 2 === 1) {
                formattedLines.push(this.formatLine(line, options));
                inMultiLineString = true;
                continue;
            }

            // Skip markdown headers and comments (preserve as-is)
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
                formattedLines.push(line);
                continue;
            }

            // Skip empty lines (preserve)
            if (trimmed === '') {
                formattedLines.push('');
                continue;
            }

            formattedLines.push(this.formatLine(line, options));
        }

        return formattedLines.join('\n');
    }

    private formatLine(line: string, options: vscode.FormattingOptions): string {
        const trimmed = line.trim();
        
        // Empty line
        if (trimmed === '') {
            return '';
        }

        // Comment line - preserve
        if (trimmed.startsWith('//')) {
            return line;
        }

        // Markdown header - preserve
        if (trimmed.startsWith('#')) {
            return line;
        }

        // Pipe at start of line - indent it
        if (trimmed.startsWith('|')) {
            return this.formatPipeOperator(trimmed, options);
        }

        // Let statement
        if (trimmed.startsWith('let ')) {
            return this.formatLetStatement(trimmed);
        }

        // Table name at start (no formatting needed, just trim)
        return trimmed;
    }

    private formatPipeOperator(line: string, options: vscode.FormattingOptions): string {
        // Standard indent for pipe operators
        const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
        
        // Normalize the pipe operator line
        let formatted = line;

        // Ensure space after pipe
        formatted = formatted.replace(/^\|\s*/, '| ');

        // Format common operators with proper spacing
        formatted = this.formatOperatorSpacing(formatted);

        return formatted;
    }

    private formatLetStatement(line: string): string {
        let formatted = line;

        // Ensure proper spacing around = in let statements
        formatted = formatted.replace(/let\s+(\w+)\s*=\s*/, 'let $1 = ');

        return formatted;
    }

    private formatOperatorSpacing(line: string): string {
        let formatted = line;

        // Don't modify strings - extract them first
        const strings: string[] = [];
        formatted = formatted.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
            strings.push(match);
            return `__STRING_${strings.length - 1}__`;
        });
        formatted = formatted.replace(/'(?:[^'\\]|\\.)*'/g, (match) => {
            strings.push(match);
            return `__STRING_${strings.length - 1}__`;
        });

        // Comparison operators: ensure spaces around them
        formatted = formatted.replace(/\s*(==|!=|>=|<=|=~|!~)\s*/g, ' $1 ');
        
        // Single character comparison (but not in ==, !=, etc.)
        formatted = formatted.replace(/([^=!<>])\s*([<>])\s*([^=])/g, '$1 $2 $3');

        // Logical operators
        formatted = formatted.replace(/\s+and\s+/gi, ' and ');
        formatted = formatted.replace(/\s+or\s+/gi, ' or ');

        // Comma spacing in function calls and lists
        formatted = formatted.replace(/,\s*/g, ', ');
        
        // Remove space before comma
        formatted = formatted.replace(/\s+,/g, ',');

        // Remove multiple spaces (but preserve indentation)
        formatted = formatted.replace(/  +/g, ' ');

        // Restore strings
        for (let i = 0; i < strings.length; i++) {
            formatted = formatted.replace(`__STRING_${i}__`, strings[i]);
        }

        return formatted;
    }
}

export class KqlRangeFormattingProvider implements vscode.DocumentRangeFormattingEditProvider {
    private formatter = new KqlFormattingProvider();

    provideDocumentRangeFormattingEdits(
        document: vscode.TextDocument,
        range: vscode.Range,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        // For range formatting, we extract the range and format it
        const text = document.getText(range);
        const lines = text.split('\n');
        const formattedLines: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) {
                formattedLines.push(line);
                continue;
            }

            if (trimmed.startsWith('|')) {
                const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
                formattedLines.push(indent + this.formatOperatorSpacing(trimmed));
            } else {
                formattedLines.push(trimmed);
            }
        }

        const formatted = formattedLines.join('\n');
        
        if (formatted !== text) {
            return [vscode.TextEdit.replace(range, formatted)];
        }
        
        return [];
    }

    private formatOperatorSpacing(line: string): string {
        let formatted = line;

        // Ensure space after pipe
        formatted = formatted.replace(/^\|\s*/, '| ');

        // Don't modify strings
        const strings: string[] = [];
        formatted = formatted.replace(/"(?:[^"\\]|\\.)*"/g, (match) => {
            strings.push(match);
            return `__STRING_${strings.length - 1}__`;
        });

        // Comparison operators
        formatted = formatted.replace(/\s*(==|!=|>=|<=|=~|!~)\s*/g, ' $1 ');
        
        // Comma spacing
        formatted = formatted.replace(/,\s*/g, ', ');
        formatted = formatted.replace(/\s+,/g, ',');

        // Remove multiple spaces
        formatted = formatted.replace(/  +/g, ' ');

        // Restore strings
        for (let i = 0; i < strings.length; i++) {
            formatted = formatted.replace(`__STRING_${i}__`, strings[i]);
        }

        return formatted;
    }
}

