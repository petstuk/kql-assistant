import * as vscode from 'vscode';

export class KqlCodeActionProvider implements vscode.CodeActionProvider {
    
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    /** Command to trigger feedback prompt after a code action is applied */
    private static readonly FEEDBACK_COMMAND: vscode.Command = {
        command: 'kql-assistant.triggerFeedback',
        title: 'Trigger Feedback'
    };

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        
        const actions: vscode.CodeAction[] = [];

        // Process each diagnostic in the context
        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'KQL Assistant') {
                continue;
            }

            const message = diagnostic.message;

            // "Did you mean 'X'?" suggestions for columns and tables
            const didYouMeanMatch = message.match(/Did you mean '([^']+)'\?/);
            if (didYouMeanMatch) {
                const suggestion = didYouMeanMatch[1];
                const action = this.createReplaceAction(
                    document,
                    diagnostic.range,
                    suggestion,
                    `Change to '${suggestion}'`
                );
                if (action) {
                    action.isPreferred = true;
                    actions.push(action);
                }
            }

            // SQL-to-KQL migration fixes
            if (message.includes('SELECT')) {
                actions.push(...this.createSqlMigrationFixes(document, diagnostic, 'SELECT', 'project'));
            }
            if (message.includes('FROM')) {
                actions.push(...this.createFromFix(document, diagnostic));
            }
            if (message.includes('GROUP BY')) {
                actions.push(...this.createSqlMigrationFixes(document, diagnostic, 'GROUP BY', 'summarize'));
            }
            if (message.includes('ORDER BY')) {
                actions.push(...this.createSqlMigrationFixes(document, diagnostic, 'ORDER BY', 'order by'));
            }

            // Unknown table suggestions
            if (message.startsWith("Unknown table '")) {
                const tableMatch = message.match(/Unknown table '([^']+)'/);
                if (tableMatch) {
                    const tableName = tableMatch[1];
                    // Offer to add to custom schema or ignore
                    const ignoreAction = new vscode.CodeAction(
                        `Ignore unknown table '${tableName}'`,
                        vscode.CodeActionKind.QuickFix
                    );
                    ignoreAction.diagnostics = [diagnostic];
                    // This would require a way to store ignored tables - future enhancement
                }
            }

            // Unclosed bracket fixes
            if (message.includes('Unclosed') || message.includes('unclosed')) {
                const bracketFixes = this.createBracketFixes(document, diagnostic, message);
                actions.push(...bracketFixes);
            }

            // Missing pipe operator
            if (message.includes('Missing pipe operator')) {
                const pipeFix = this.createPipeOperatorFix(document, diagnostic);
                if (pipeFix) {
                    actions.push(pipeFix);
                }
            }
        }

        return actions.length > 0 ? actions : undefined;
    }

    private createReplaceAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        replacement: string,
        title: string
    ): vscode.CodeAction | undefined {
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, range, replacement);
        
        // Trigger feedback check when action is applied
        action.command = KqlCodeActionProvider.FEEDBACK_COMMAND;
        
        return action;
    }

    private createSqlMigrationFixes(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        sqlKeyword: string,
        kqlKeyword: string
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        
        const line = document.lineAt(diagnostic.range.start.line).text;
        const regex = new RegExp(sqlKeyword, 'i');
        const match = line.match(regex);
        
        if (match) {
            const startIndex = line.indexOf(match[0]);
            const range = new vscode.Range(
                diagnostic.range.start.line,
                startIndex,
                diagnostic.range.start.line,
                startIndex + match[0].length
            );

            const action = new vscode.CodeAction(
                `Change '${sqlKeyword}' to '${kqlKeyword}'`,
                vscode.CodeActionKind.QuickFix
            );
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(document.uri, range, kqlKeyword);
            action.isPreferred = true;
            action.diagnostics = [diagnostic];
            action.command = KqlCodeActionProvider.FEEDBACK_COMMAND;
            actions.push(action);
        }

        return actions;
    }

    private createFromFix(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        
        const line = document.lineAt(diagnostic.range.start.line).text;
        
        // In KQL, you start with the table name, not "from TableName"
        // Suggest removing "from" and putting table at the start
        const fromMatch = line.match(/\bfrom\s+(\w+)/i);
        if (fromMatch) {
            const tableName = fromMatch[1];
            
            const action = new vscode.CodeAction(
                `Remove 'from' (KQL starts with table name)`,
                vscode.CodeActionKind.QuickFix
            );
            action.edit = new vscode.WorkspaceEdit();
            
            // Replace the whole line with just the table name
            const lineRange = new vscode.Range(
                diagnostic.range.start.line, 0,
                diagnostic.range.start.line, line.length
            );
            action.edit.replace(document.uri, lineRange, tableName);
            action.isPreferred = true;
            action.diagnostics = [diagnostic];
            action.command = KqlCodeActionProvider.FEEDBACK_COMMAND;
            actions.push(action);
        }

        return actions;
    }

    private createBracketFixes(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        message: string
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        
        // Determine what type of bracket is unclosed
        let closingBracket = '';
        if (message.includes('parenthes') || message.includes('(')) {
            closingBracket = ')';
        } else if (message.includes('bracket') || message.includes('[')) {
            closingBracket = ']';
        } else if (message.includes('brace') || message.includes('{')) {
            closingBracket = '}';
        }

        if (closingBracket) {
            // Insert at end of line
            const line = document.lineAt(diagnostic.range.start.line);
            const insertPosition = new vscode.Position(line.lineNumber, line.text.length);

            const action = new vscode.CodeAction(
                `Add closing '${closingBracket}'`,
                vscode.CodeActionKind.QuickFix
            );
            action.edit = new vscode.WorkspaceEdit();
            action.edit.insert(document.uri, insertPosition, closingBracket);
            action.diagnostics = [diagnostic];
            action.command = KqlCodeActionProvider.FEEDBACK_COMMAND;
            actions.push(action);
        }

        return actions;
    }

    private createPipeOperatorFix(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | undefined {
        const line = document.lineAt(diagnostic.range.start.line).text;
        const trimmed = line.trim();
        
        // Check if line starts with an operator that should have a pipe
        const operators = ['where', 'project', 'extend', 'summarize', 'order', 'sort', 'take', 'limit', 'top', 'distinct', 'count', 'render', 'join', 'union'];
        
        for (const op of operators) {
            if (trimmed.toLowerCase().startsWith(op + ' ') || trimmed.toLowerCase() === op) {
                const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';
                
                const action = new vscode.CodeAction(
                    `Add pipe operator before '${op}'`,
                    vscode.CodeActionKind.QuickFix
                );
                action.edit = new vscode.WorkspaceEdit();
                
                const lineRange = new vscode.Range(
                    diagnostic.range.start.line, 0,
                    diagnostic.range.start.line, line.length
                );
                action.edit.replace(document.uri, lineRange, `${leadingWhitespace}| ${trimmed}`);
                action.isPreferred = true;
                action.diagnostics = [diagnostic];
                action.command = KqlCodeActionProvider.FEEDBACK_COMMAND;
                
                return action;
            }
        }

        return undefined;
    }
}


