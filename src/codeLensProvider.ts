import * as vscode from 'vscode';
import { findRuleAtLine, formatMetadataSummary, isCategoryHeader, isRuleHeader } from './ruleMetadata';

/**
 * Provides CodeLens actions inline on ## rule and # category header lines.
 */
export class KqlCodeLensProvider implements vscode.CodeLensProvider {

    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const lineCount = document.lineCount;
        const text = document.getText();

        const headers: { line: number; level: number }[] = [];
        for (let i = 0; i < lineCount; i++) {
            const lineText = document.lineAt(i).text.trim();
            if (isRuleHeader(lineText)) {
                headers.push({ line: i, level: 2 });
            } else if (isCategoryHeader(lineText)) {
                headers.push({ line: i, level: 1 });
            }
        }

        for (let idx = 0; idx < headers.length; idx++) {
            const header = headers[idx];
            const range = new vscode.Range(
                header.line,
                0,
                header.line,
                document.lineAt(header.line).text.length
            );

            if (header.level === 2) {
                const endLine = findSectionEnd(document, header.line, headers, idx);
                const queryLines = countQueryLines(document, header.line, endLine);
                const rule = findRuleAtLine(text, header.line);
                const metaSummary = rule ? formatMetadataSummary(rule) : '';

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
                    title: '$(export) Export Rule',
                    command: 'kql-assistant.exportAnalyticsRule',
                    arguments: [{ line: header.line }],
                    tooltip: 'Export a Sentinel analytics rule YAML stub'
                }));

                if (metaSummary) {
                    lenses.push(new vscode.CodeLens(range, {
                        title: `· ${metaSummary}`,
                        command: '',
                        tooltip: 'Parsed from // tactic / technique / severity metadata'
                    }));
                }

                lenses.push(new vscode.CodeLens(range, {
                    title: `· ${queryLines} ${queryLines === 1 ? 'line' : 'lines'}`,
                    command: '',
                    tooltip: `This query has ${queryLines} lines`
                }));

            } else if (header.level === 1) {
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

    let end = document.lineCount - 1;
    while (end > startLine && document.lineAt(end).text.trim() === '') {
        end--;
    }
    return end;
}

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
