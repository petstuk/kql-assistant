import * as vscode from 'vscode';
import { KqlCodeActionProvider } from './codeActionProvider';
import { KqlCompletionProvider } from './completionProvider';
import { KqlHoverProvider } from './hoverProvider';
import { KqlSignatureHelpProvider } from './signatureHelpProvider';
import {
    kqlRangeToYaml,
    LineColumnRange,
    queryBlockAt,
    YamlQueryBlock,
    yamlRangeToKql
} from './sentinelYaml';

/**
 * Run the existing KQL providers against the dedented `query: |` block under
 * the cursor, then shift any ranges back onto the YAML document.
 * Positions outside a query block return nothing.
 */

export function createYamlCompletionProvider(
    inner: KqlCompletionProvider
): vscode.CompletionItemProvider {
    return {
        provideCompletionItems(document, position, token, context) {
            const mapped = project(document, position.line, position.character);
            if (!mapped) {
                return undefined;
            }
            return inner.provideCompletionItems(mapped.doc, mapped.position, token, context);
        }
    };
}

export function createYamlHoverProvider(inner: KqlHoverProvider): vscode.HoverProvider {
    return {
        provideHover(document, position, token) {
            const mapped = project(document, position.line, position.character);
            if (!mapped) {
                return undefined;
            }
            return mapResult(inner.provideHover(mapped.doc, mapped.position, token), hover =>
                remapHover(mapped.block, hover)
            );
        }
    };
}

export function createYamlSignatureHelpProvider(
    inner: KqlSignatureHelpProvider
): vscode.SignatureHelpProvider {
    return {
        provideSignatureHelp(document, position, token, context) {
            const mapped = project(document, position.line, position.character);
            if (!mapped) {
                return undefined;
            }
            return inner.provideSignatureHelp(mapped.doc, mapped.position, token, context);
        }
    };
}

export function createYamlCodeActionProvider(
    inner: KqlCodeActionProvider
): vscode.CodeActionProvider {
    return {
        provideCodeActions(document, range, context, token) {
            const text = document.getText();
            const anchor = queryBlockAt(text, range.start.line, range.start.character);
            const block =
                anchor?.block ?? blockContainingDiagnostics(text, context.diagnostics);
            if (!block) {
                return undefined;
            }

            const inBlock = context.diagnostics.filter(diagnostic =>
                diagnosticInBlock(diagnostic, block)
            );
            if (inBlock.length === 0) {
                return [];
            }

            const originals = new Map<vscode.Diagnostic, vscode.Diagnostic>();
            const kqlDiagnostics = inBlock.map(diagnostic => {
                const clone = new vscode.Diagnostic(
                    toVscodeRange(yamlRangeToKql(block, toPlain(diagnostic.range))),
                    diagnostic.message,
                    diagnostic.severity
                );
                clone.source = diagnostic.source;
                clone.code = diagnostic.code;
                originals.set(clone, diagnostic);
                return clone;
            });

            const view = kqlDocument(document.uri, block);
            const kqlRange = toVscodeRange(yamlRangeToKql(block, toPlain(range)));
            const result = inner.provideCodeActions(
                view,
                kqlRange,
                { ...context, diagnostics: kqlDiagnostics },
                token
            );
            return mapResult(result, actions =>
                actions.map(action => remapAction(action, block, originals))
            );
        }
    };
}

function project(
    document: vscode.TextDocument,
    line: number,
    character: number
): { block: YamlQueryBlock; doc: vscode.TextDocument; position: vscode.Position } | undefined {
    const hit = queryBlockAt(document.getText(), line, character);
    if (!hit) {
        return undefined;
    }
    return {
        block: hit.block,
        doc: kqlDocument(document.uri, hit.block),
        position: new vscode.Position(hit.kqlLine, hit.kqlCharacter)
    };
}

function kqlDocument(uri: vscode.Uri, block: YamlQueryBlock): vscode.TextDocument {
    const text = block.text;
    const lines = text.split('\n');
    const doc = {
        uri,
        languageId: 'kql',
        version: 1,
        lineCount: lines.length,
        getText(range?: vscode.Range): string {
            if (!range) {
                return text;
            }
            return textInRange(lines, range);
        },
        lineAt(lineOrPos: number | vscode.Position): vscode.TextLine {
            const line = typeof lineOrPos === 'number' ? lineOrPos : lineOrPos.line;
            const lineText = lines[line] ?? '';
            return {
                lineNumber: line,
                text: lineText,
                range: new vscode.Range(line, 0, line, lineText.length),
                rangeIncludingLineBreak: new vscode.Range(line, 0, line + 1, 0),
                firstNonWhitespaceCharacterIndex: lineText.search(/\S|$/),
                isEmptyOrWhitespace: lineText.trim() === ''
            };
        },
        getWordRangeAtPosition(
            position: vscode.Position,
            regex?: RegExp
        ): vscode.Range | undefined {
            const lineText = lines[position.line] ?? '';
            return wordRange(lineText, position.line, position.character, regex ?? /[\w-]+/);
        }
    };
    return doc as unknown as vscode.TextDocument;
}

function textInRange(lines: string[], range: vscode.Range): string {
    if (range.start.line === range.end.line) {
        return (lines[range.start.line] ?? '').slice(range.start.character, range.end.character);
    }
    const parts: string[] = [];
    for (let i = range.start.line; i <= range.end.line && i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (i === range.start.line) {
            parts.push(line.slice(range.start.character));
        } else if (i === range.end.line) {
            parts.push(line.slice(0, range.end.character));
        } else {
            parts.push(line);
        }
    }
    return parts.join('\n');
}

function wordRange(
    lineText: string,
    line: number,
    character: number,
    regex: RegExp
): vscode.Range | undefined {
    const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
    const re = new RegExp(regex.source, flags);
    let containing: { start: number; end: number } | undefined;
    let ending: { start: number; end: number } | undefined;
    let match: RegExpExecArray | null;
    while ((match = re.exec(lineText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (character >= start && character < end) {
            containing = { start, end };
        } else if (character === end) {
            ending = { start, end };
        }
        if (match[0].length === 0) {
            re.lastIndex++;
        }
    }
    const found = containing ?? ending;
    if (!found) {
        return undefined;
    }
    return new vscode.Range(line, found.start, line, found.end);
}

function remapHover(block: YamlQueryBlock, hover: vscode.Hover): vscode.Hover {
    if (hover.range) {
        hover.range = toVscodeRange(kqlRangeToYaml(block, toPlain(hover.range)));
    }
    return hover;
}

function remapAction(
    action: vscode.CodeAction,
    block: YamlQueryBlock,
    originals: Map<vscode.Diagnostic, vscode.Diagnostic>
): vscode.CodeAction {
    if (action.edit) {
        const next = new vscode.WorkspaceEdit();
        for (const [uri, edits] of action.edit.entries()) {
            for (const edit of edits) {
                next.replace(
                    uri,
                    toVscodeRange(kqlRangeToYaml(block, toPlain(edit.range))),
                    edit.newText
                );
            }
        }
        action.edit = next;
    }
    if (action.diagnostics) {
        action.diagnostics = action.diagnostics.map(diagnostic => originals.get(diagnostic) ?? diagnostic);
    }
    return action;
}

function diagnosticInBlock(diagnostic: vscode.Diagnostic, block: YamlQueryBlock): boolean {
    const lineCount = block.text.split('\n').length;
    const endLine = block.startLine + lineCount - 1;
    return diagnostic.range.start.line >= block.startLine && diagnostic.range.start.line <= endLine;
}

function blockContainingDiagnostics(
    yaml: string,
    diagnostics: readonly vscode.Diagnostic[]
): YamlQueryBlock | undefined {
    for (const diagnostic of diagnostics) {
        const hit = queryBlockAt(
            yaml,
            diagnostic.range.start.line,
            diagnostic.range.start.character
        );
        if (hit) {
            return hit.block;
        }
    }
    return undefined;
}

function toPlain(range: vscode.Range): LineColumnRange {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character }
    };
}

function toVscodeRange(range: LineColumnRange): vscode.Range {
    return new vscode.Range(
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character
    );
}

function mapResult<T>(
    result: vscode.ProviderResult<T>,
    map: (value: T) => T
): vscode.ProviderResult<T> {
    if (isThenable(result)) {
        return Promise.resolve(result).then(value =>
            value === undefined || value === null ? undefined : map(value)
        );
    }
    if (result === undefined || result === null) {
        return result;
    }
    return map(result);
}

function isThenable<T>(value: vscode.ProviderResult<T>): value is Thenable<T | undefined | null> {
    return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}
