import * as vscode from 'vscode';
import { KQL_DIAGNOSTIC_SOURCE } from './diagnostics';

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
            if (diagnostic.source !== KQL_DIAGNOSTIC_SOURCE) {
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
            // Messages from syntaxChecker: 'KQL uses "project" instead of "select"'
            //                              'KQL starts with table name, no "from" keyword needed'
            if (message.includes('"select"')) {
                actions.push(...this.createSqlMigrationFixes(document, diagnostic, 'select', 'project'));
            }
            if (message.includes('"from"')) {
                actions.push(...this.createFromFix(document, diagnostic));
            }

            // Unknown table suggestions
            if (message.startsWith("Unknown table '")) {
                const tableMatch = message.match(/Unknown table '([^']+)'/);
                if (tableMatch) {
                    const tableName = tableMatch[1];
                    const ignoreAction = new vscode.CodeAction(
                        `Ignore unknown table '${tableName}'`,
                        vscode.CodeActionKind.QuickFix
                    );
                    ignoreAction.diagnostics = [diagnostic];
                    ignoreAction.command = {
                        command: 'kql-assistant.ignoreUnknownTable',
                        title: `Ignore unknown table '${tableName}'`,
                        arguments: [tableName]
                    };
                    actions.push(ignoreAction);
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
        // Remove the "from " prefix while preserving the rest of the line
        const fromMatch = line.match(/(\bfrom\s+)(\w+)/i);
        if (fromMatch) {
            const fromPrefix = fromMatch[1]; // e.g. "from "
            const startIndex = line.search(/\bfrom\s+/i);
            const fromRange = new vscode.Range(
                diagnostic.range.start.line, startIndex,
                diagnostic.range.start.line, startIndex + fromPrefix.length
            );
            
            const action = new vscode.CodeAction(
                `Remove 'from' (KQL starts with table name)`,
                vscode.CodeActionKind.QuickFix
            );
            action.edit = new vscode.WorkspaceEdit();
            action.edit.delete(document.uri, fromRange);
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
            // For document-level bracket errors (reported at line 0, col 0), insert at end of document
            const isDocumentLevel =
                diagnostic.range.start.line === 0 && diagnostic.range.start.character === 0;
            const targetLineNum = isDocumentLevel
                ? document.lineCount - 1
                : diagnostic.range.start.line;
            const line = document.lineAt(targetLineNum);
            const insertPosition = new vscode.Position(targetLineNum, line.text.length);

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


