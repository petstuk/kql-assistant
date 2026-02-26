import * as vscode from 'vscode';

/**
 * Provides CodeLens actions (Copy, Select) inline on ## and # header lines.
 *
 * ## Signinlogs Lookup ##    📋 Copy Query    ✓ Select Query
 * SignInLogs
 * | where TimeGenerated > ago(5d)
 */
export class KqlCodeLensProvider implements vscode.CodeLensProvider {

    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];

        for (let i = 0; i < document.lineCount; i++) {
            const lineText = document.lineAt(i).text.trim();

            const isRule = lineText.match(/^##\s+.+\s+##\s*$/);
            const isCategory = !lineText.startsWith('###') && lineText.match(/^#\s+[^#].+[^#]\s*#\s*$/) && !lineText.startsWith('##');

            if (isRule) {
                const range = new vscode.Range(i, 0, i, document.lineAt(i).text.length);

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(copy) Copy Query',
                    command: 'kql-assistant.copyCurrentQuery',
                    arguments: [{ line: i }],
                    tooltip: 'Copy query body to clipboard'
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(list-selection) Select Query',
                    command: 'kql-assistant.selectCurrentQuery',
                    arguments: [{ line: i }],
                    tooltip: 'Select entire query block in editor'
                }));
            } else if (isCategory) {
                const range = new vscode.Range(i, 0, i, document.lineAt(i).text.length);

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(list-selection) Select All',
                    command: 'kql-assistant.selectCurrentQuery',
                    arguments: [{ line: i }],
                    tooltip: 'Select entire category block in editor'
                }));
            }
        }

        return lenses;
    }

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }
}
