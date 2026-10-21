import * as vscode from 'vscode';
import { KqlDiagnosticsProvider } from './diagnostics';
import { KqlCompletionProvider } from './completionProvider';
import { KqlDocumentSymbolProvider } from './symbolProvider';
import { KqlHoverProvider } from './hoverProvider';
import { KqlSignatureHelpProvider } from './signatureHelpProvider';
import { KqlFormattingProvider, KqlRangeFormattingProvider } from './formattingProvider';
import { KqlCodeActionProvider } from './codeActionProvider';
import { showFeedbackPrompt, initializeFeedback } from './feedback';
import { KqlFoldingRangeProvider, findQueryBoundaries, getQueryText } from './foldingProvider';
import { KqlCodeLensProvider } from './codeLensProvider';
import { KqlSchemaValidator } from './schemaValidator';
import { findRuleAtLine } from './ruleMetadata';
import { buildAnalyticsRuleYaml } from './analyticsRuleExport';
import { sentinelYamlToKql } from './sentinelYaml';
import { KqlLetDefinitionProvider, KqlLetReferenceProvider, KqlLetRenameProvider } from './letSymbolProvider';
import {
    createYamlCodeActionProvider,
    createYamlCompletionProvider,
    createYamlHoverProvider,
    createYamlSignatureHelpProvider
} from './yamlQueryHost';

let diagnosticsProvider: KqlDiagnosticsProvider | undefined;
const DIAGNOSTICS_DEBOUNCE_MS = 250;
const diagnosticDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const CHECK_SYNTAX_SCOPE_MESSAGE =
    'Offline heuristic check completed (bundled schema; does not execute against Azure).';

function scheduleDiagnosticsUpdate(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = diagnosticDebounceTimers.get(key);
    if (existing) {
        clearTimeout(existing);
    }
    diagnosticDebounceTimers.set(
        key,
        setTimeout(() => {
            diagnosticDebounceTimers.delete(key);
            diagnosticsProvider?.updateDiagnostics(document);
        }, DIAGNOSTICS_DEBOUNCE_MS)
    );
}

function checkSuccessAndShowFeedback(uri: vscode.Uri): void {
    if (!diagnosticsProvider) {
        return;
    }
    if (!diagnosticsProvider.hasOutstandingIssues(uri)) {
        showFeedbackPrompt();
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('KQL Assistant extension is now active');

    initializeFeedback(context);

    const schemaValidator = new KqlSchemaValidator(context);
    diagnosticsProvider = new KqlDiagnosticsProvider(context, schemaValidator);

    const kqlCompletionProvider = new KqlCompletionProvider(schemaValidator);
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'kql',
        kqlCompletionProvider,
        '|',
        '.',
        '(',
        ' '
    );
    context.subscriptions.push(completionProvider);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'yaml' },
            createYamlCompletionProvider(kqlCompletionProvider),
            '|',
            '.',
            '(',
            ' '
        )
    );

    const symbolProvider = vscode.languages.registerDocumentSymbolProvider(
        'kql',
        new KqlDocumentSymbolProvider()
    );
    context.subscriptions.push(symbolProvider);

    const kqlHoverProvider = new KqlHoverProvider(schemaValidator);
    const hoverProvider = vscode.languages.registerHoverProvider(
        'kql',
        kqlHoverProvider
    );
    context.subscriptions.push(hoverProvider);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'yaml' },
            createYamlHoverProvider(kqlHoverProvider)
        )
    );

    const kqlSignatureHelpProvider = new KqlSignatureHelpProvider();
    const signatureHelpProvider = vscode.languages.registerSignatureHelpProvider(
        'kql',
        kqlSignatureHelpProvider,
        '(',
        ','
    );
    context.subscriptions.push(signatureHelpProvider);
    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider(
            { language: 'yaml' },
            createYamlSignatureHelpProvider(kqlSignatureHelpProvider),
            '(',
            ','
        )
    );

    const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
        'kql',
        new KqlFormattingProvider()
    );
    context.subscriptions.push(formattingProvider);

    const rangeFormattingProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
        'kql',
        new KqlRangeFormattingProvider()
    );
    context.subscriptions.push(rangeFormattingProvider);

    const kqlCodeActionProvider = new KqlCodeActionProvider();
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        'kql',
        kqlCodeActionProvider,
        {
            providedCodeActionKinds: KqlCodeActionProvider.providedCodeActionKinds
        }
    );
    context.subscriptions.push(codeActionProvider);
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { language: 'yaml' },
            createYamlCodeActionProvider(kqlCodeActionProvider),
            {
                providedCodeActionKinds: KqlCodeActionProvider.providedCodeActionKinds
            }
        )
    );

    const foldingProvider = vscode.languages.registerFoldingRangeProvider(
        'kql',
        new KqlFoldingRangeProvider()
    );
    context.subscriptions.push(foldingProvider);

    const codeLensProvider = new KqlCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'kql' }, codeLensProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider('kql', new KqlLetDefinitionProvider())
    );
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider('kql', new KqlLetReferenceProvider())
    );
    context.subscriptions.push(
        vscode.languages.registerRenameProvider('kql', new KqlLetRenameProvider())
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'kql') {
                codeLensProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (isLintableDocument(doc)) {
                diagnosticsProvider?.updateDiagnostics(doc);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (isLintableDocument(e.document)) {
                scheduleDiagnosticsUpdate(e.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (isLintableDocument(doc)) {
                const key = doc.uri.toString();
                const pending = diagnosticDebounceTimers.get(key);
                if (pending) {
                    clearTimeout(pending);
                    diagnosticDebounceTimers.delete(key);
                }
                diagnosticsProvider?.updateDiagnostics(doc);
                setTimeout(() => checkSuccessAndShowFeedback(doc.uri), 100);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (isLintableDocument(doc)) {
                const key = doc.uri.toString();
                const pending = diagnosticDebounceTimers.get(key);
                if (pending) {
                    clearTimeout(pending);
                    diagnosticDebounceTimers.delete(key);
                }
                diagnosticsProvider?.clearDiagnostics(doc);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (
                e.affectsConfiguration('kqlAssistant.userSchemaPath') ||
                e.affectsConfiguration('kqlAssistant.ignoredTables') ||
                e.affectsConfiguration('kqlAssistant.lintMode') ||
                e.affectsConfiguration('kqlAssistant.schemaPacks')
            ) {
                if (
                    e.affectsConfiguration('kqlAssistant.userSchemaPath') ||
                    e.affectsConfiguration('kqlAssistant.schemaPacks')
                ) {
                    diagnosticsProvider?.reloadSchemas();
                }
                vscode.workspace.textDocuments.forEach(doc => {
                    if (isLintableDocument(doc)) {
                        diagnosticsProvider?.updateDiagnostics(doc);
                    }
                });
            }
        })
    );

    vscode.workspace.textDocuments.forEach(doc => {
        if (isLintableDocument(doc)) {
            diagnosticsProvider?.updateDiagnostics(doc);
        }
    });

    const checkSyntaxCommand = vscode.commands.registerCommand('kql-assistant.checkSyntax', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && isLintableDocument(editor.document)) {
            diagnosticsProvider?.updateDiagnostics(editor.document);
            vscode.window.showInformationMessage(CHECK_SYNTAX_SCOPE_MESSAGE);
            setTimeout(() => checkSuccessAndShowFeedback(editor.document.uri), 100);
        } else {
            vscode.window.showWarningMessage('Please open a KQL or Sentinel YAML file to check syntax');
        }
    });

    context.subscriptions.push(checkSyntaxCommand);

    context.subscriptions.push(
        vscode.commands.registerCommand('kql-assistant.triggerFeedback', () => {
            showFeedbackPrompt();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'kql-assistant.ignoreUnknownTable',
            async (tableName?: string) => {
                if (!tableName || typeof tableName !== 'string') {
                    return;
                }
                const config = vscode.workspace.getConfiguration('kqlAssistant');
                const current = config.get<string[]>('ignoredTables', []) ?? [];
                const alreadyIgnored = current.some(
                    t => t.toLowerCase() === tableName.toLowerCase()
                );
                if (!alreadyIgnored) {
                    await config.update(
                        'ignoredTables',
                        [...current, tableName],
                        vscode.ConfigurationTarget.Workspace
                    );
                }
                vscode.window.showInformationMessage(
                    `Ignoring unknown table '${tableName}' in this workspace (kqlAssistant.ignoredTables).`
                );
                vscode.workspace.textDocuments.forEach(doc => {
                    if (isLintableDocument(doc)) {
                        diagnosticsProvider?.updateDiagnostics(doc);
                    }
                });
                showFeedbackPrompt();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('kql-assistant.selectCurrentQuery', (args?: { line?: number }) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'kql') {
                vscode.window.showWarningMessage('Please open a KQL file');
                return;
            }

            const lineNumber = args?.line ?? editor.selection.active.line;
            const boundaries = findQueryBoundaries(editor.document, lineNumber);

            if (!boundaries) {
                vscode.window.showInformationMessage('No query section found at cursor position');
                return;
            }

            const startPos = new vscode.Position(boundaries.startLine, 0);
            const endLine = editor.document.lineAt(boundaries.endLine);
            const endPos = new vscode.Position(boundaries.endLine, endLine.text.length);

            editor.selection = new vscode.Selection(startPos, endPos);
            editor.revealRange(new vscode.Range(startPos, endPos));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('kql-assistant.copyCurrentQuery', async (args?: { line?: number }) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'kql') {
                vscode.window.showWarningMessage('Please open a KQL file');
                return;
            }

            const lineNumber = args?.line ?? editor.selection.active.line;
            const queryText = getQueryText(editor.document, lineNumber);

            if (!queryText) {
                vscode.window.showInformationMessage('No query found at cursor position');
                return;
            }

            await vscode.env.clipboard.writeText(queryText);
            vscode.window.showInformationMessage('Query copied to clipboard');
            showFeedbackPrompt();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'kql-assistant.exportAnalyticsRule',
            async (args?: { line?: number }) => {
                const editor = vscode.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'kql') {
                    vscode.window.showWarningMessage('Please open a KQL file');
                    return;
                }

                const lineNumber = args?.line ?? editor.selection.active.line;
                const rule = findRuleAtLine(editor.document.getText(), lineNumber);
                if (!rule) {
                    vscode.window.showInformationMessage(
                        'Place the cursor in a ## Rule ## section (with optional // tactic / technique / severity metadata).'
                    );
                    return;
                }

                const yaml = buildAnalyticsRuleYaml(editor.document.getText(), rule);
                const doc = await vscode.workspace.openTextDocument({
                    content: yaml,
                    language: 'yaml'
                });
                await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
                vscode.window.showInformationMessage(
                    `Exported analytics rule for "${rule.title}" — review mappings and connectors before deploying.`
                );
                showFeedbackPrompt();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('kql-assistant.importAnalyticsRule', async () => {
            const editor = vscode.window.activeTextEditor;
            let yamlText: string | undefined;

            if (editor && isYamlDocument(editor.document)) {
                yamlText = editor.document.getText();
            } else {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: { YAML: ['yaml', 'yml'] }
                });
                if (!picked || picked.length === 0) {
                    return;
                }
                const bytes = await vscode.workspace.fs.readFile(picked[0]);
                yamlText = Buffer.from(bytes).toString('utf8');
            }

            const kql = sentinelYamlToKql(yamlText);
            if (!kql) {
                vscode.window.showWarningMessage(
                    'No Sentinel query: | block found in this YAML.'
                );
                return;
            }

            const doc = await vscode.workspace.openTextDocument({
                content: kql,
                language: 'kql'
            });
            await vscode.window.showTextDocument(doc, {
                preview: false,
                viewColumn: vscode.ViewColumn.Beside
            });
            vscode.window.showInformationMessage('Imported analytics rule into a KQL document.');
            showFeedbackPrompt();
        })
    );
}

function isKqlDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'kql';
}

function isYamlDocument(document: vscode.TextDocument): boolean {
    return (
        document.languageId === 'yaml' ||
        document.fileName.toLowerCase().endsWith('.yaml') ||
        document.fileName.toLowerCase().endsWith('.yml')
    );
}

function isLintableDocument(document: vscode.TextDocument): boolean {
    return isKqlDocument(document) || isYamlDocument(document);
}

export function deactivate() {
    for (const timer of diagnosticDebounceTimers.values()) {
        clearTimeout(timer);
    }
    diagnosticDebounceTimers.clear();

    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
        diagnosticsProvider = undefined;
    }
}
