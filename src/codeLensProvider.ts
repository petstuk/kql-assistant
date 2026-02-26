import * as vscode from 'vscode';

/**
 * Provides CodeLens actions inline on ## rule and # category header lines.
 *
 * ## Signinlogs Lookup ##    📋 Copy Query    ✓ Select Query    · 8 lines
 * # Identity Threats #    · 4 rules    ✓ Select All
 */
export class KqlCodeLensProvider implements vscode.CodeLensProvider {

    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const lineCount = document.lineCount;

        // Pre-scan: collect all header positions for rule counting
        const headers: { line: number; level: number }[] = [];
        for (let i = 0; i < lineCount; i++) {
            const text = document.lineAt(i).text.trim();
            if (isRuleHeader(text)) {
                headers.push({ line: i, level: 2 });
            } else if (isCategoryHeader(text)) {
                headers.push({ line: i, level: 1 });
            }
        }

        for (let idx = 0; idx < headers.length; idx++) {
            const header = headers[idx];
            const range = new vscode.Range(header.line, 0, header.line, document.lineAt(header.line).text.length);

            if (header.level === 2) {
                // ## Rule ## — count query body lines
                const endLine = findSectionEnd(document, header.line, headers, idx);
                const queryLines = countQueryLines(document, header.line, endLine);

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(copy) Copy Query',
                    command: 'kql-assistant.copyCurrentQuery',
                    arguments: [{ line: header.line }],
                    tooltip: 'Copy query body to clipboard'
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(list-selection) Select Query',
                    command: 'kql-assistant.selectCurrentQuery',
                    arguments: [{ line: header.line }],
                    tooltip: 'Select entire query block in editor'
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: `· ${queryLines} ${queryLines === 1 ? 'line' : 'lines'}`,
                    command: '',
                    tooltip: `This query has ${queryLines} lines`
                }));

            } else if (header.level === 1) {
                // # Category # — count how many ## rules are directly inside it
                const endLine = findSectionEnd(document, header.line, headers, idx);
                const ruleCount = headers.filter(h =>
                    h.level === 2 && h.line > header.line && h.line <= endLine
                ).length;

                lenses.push(new vscode.CodeLens(range, {
                    title: `· ${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}`,
                    command: '',
                    tooltip: `This category contains ${ruleCount} detection rules`
                }));

                lenses.push(new vscode.CodeLens(range, {
                    title: '$(list-selection) Select All',
                    command: 'kql-assistant.selectCurrentQuery',
                    arguments: [{ line: header.line }],
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

/** Matches ## Rule Name ## */
function isRuleHeader(text: string): boolean {
    return /^##\s+.+\s+##\s*$/.test(text);
}

/** Matches # Category Name # (but not ## or ###) */
function isCategoryHeader(text: string): boolean {
    return /^#\s+[^#].+[^#]\s*#\s*$/.test(text) && !text.startsWith('##');
}

/**
 * Returns the last line index that belongs to this section,
 * stopping before the next header at the same or higher level.
 */
function findSectionEnd(
    document: vscode.TextDocument,
    startLine: number,
    headers: { line: number; level: number }[],
    currentIdx: number
): number {
    const currentLevel = headers[currentIdx].level;

    for (let i = currentIdx + 1; i < headers.length; i++) {
        if (headers[i].level <= currentLevel) {
            return headers[i].line - 1;
        }
    }

    // Last section - extend to end of document
    let end = document.lineCount - 1;
    while (end > startLine && document.lineAt(end).text.trim() === '') {
        end--;
    }
    return end;
}

/**
 * Counts non-empty, non-header lines in the section after the header.
 */
function countQueryLines(
    document: vscode.TextDocument,
    headerLine: number,
    endLine: number
): number {
    let count = 0;
    for (let i = headerLine + 1; i <= endLine; i++) {
        const text = document.lineAt(i).text.trim();
        if (text !== '' && !isRuleHeader(text) && !isCategoryHeader(text)) {
            count++;
        }
    }
    return count;
}
