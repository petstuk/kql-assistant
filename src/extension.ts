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

let diagnosticsProvider: KqlDiagnosticsProvider | undefined;

/**
 * Check if a document has no errors and trigger feedback prompt if appropriate
 */
function checkSuccessAndShowFeedback(uri: vscode.Uri): void {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    const hasErrors = diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error);
    if (!hasErrors) {
        showFeedbackPrompt();
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('KQL Assistant extension is now active');

    // Initialize feedback module
    initializeFeedback(context);

    // Create shared schema validator — loaded once, injected into all providers
    const schemaValidator = new KqlSchemaValidator(context);

    // Create diagnostics provider with schema validation
    diagnosticsProvider = new KqlDiagnosticsProvider(context, schemaValidator);
    
    // Register completion provider for KQL with schema support
    const kqlCompletionProvider = new KqlCompletionProvider(schemaValidator);
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'kql',
        kqlCompletionProvider,
        '|', // Trigger on pipe
        '.', // Trigger on dot
        '(', // Trigger on opening parenthesis
        ' '  // Trigger on space
    );
    context.subscriptions.push(completionProvider);

    // Register document symbol provider for outline view
    const symbolProvider = vscode.languages.registerDocumentSymbolProvider(
        'kql',
        new KqlDocumentSymbolProvider()
    );
    context.subscriptions.push(symbolProvider);

    // Register hover provider for documentation
    const hoverProvider = vscode.languages.registerHoverProvider(
        'kql',
        new KqlHoverProvider(schemaValidator)
    );
    context.subscriptions.push(hoverProvider);

    // Register signature help provider for function parameter hints
    const signatureHelpProvider = vscode.languages.registerSignatureHelpProvider(
        'kql',
        new KqlSignatureHelpProvider(),
        '(',  // Trigger on opening parenthesis
        ','   // Trigger on comma
    );
    context.subscriptions.push(signatureHelpProvider);

    // Register formatting provider for Format Document
    const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
        'kql',
        new KqlFormattingProvider()
    );
    context.subscriptions.push(formattingProvider);

    // Register range formatting provider for Format Selection
    const rangeFormattingProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
        'kql',
        new KqlRangeFormattingProvider()
    );
    context.subscriptions.push(rangeFormattingProvider);

    // Register code action provider for Quick Fixes
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        'kql',
        new KqlCodeActionProvider(),
        {
            providedCodeActionKinds: KqlCodeActionProvider.providedCodeActionKinds
        }
    );
    context.subscriptions.push(codeActionProvider);

    // Register folding range provider for collapsible sections
    const foldingProvider = vscode.languages.registerFoldingRangeProvider(
        'kql',
        new KqlFoldingRangeProvider()
    );
    context.subscriptions.push(foldingProvider);

    // Register CodeLens provider for inline Copy/Select buttons on headers
    const codeLensProvider = new KqlCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'kql' }, codeLensProvider)
    );

    // Refresh CodeLens when the document changes (headers added/removed)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'kql') {
                codeLensProvider.refresh();
            }
        })
    );
    
    // Register diagnostics on document open, change, and save
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.languageId === 'kql') {
                diagnosticsProvider?.updateDiagnostics(doc);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'kql') {
                diagnosticsProvider?.updateDiagnostics(e.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.languageId === 'kql') {
                diagnosticsProvider?.updateDiagnostics(doc);
                // Small delay to ensure diagnostics are updated before checking
                setTimeout(() => checkSuccessAndShowFeedback(doc.uri), 100);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.languageId === 'kql') {
                diagnosticsProvider?.clearDiagnostics(doc);
            }
        })
    );

    // Check all open KQL documents
    vscode.workspace.textDocuments.forEach(doc => {
        if (doc.languageId === 'kql') {
            diagnosticsProvider?.updateDiagnostics(doc);
        }
    });

    // Register a command to manually check KQL syntax
    const checkSyntaxCommand = vscode.commands.registerCommand('kql-assistant.checkSyntax', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'kql') {
            diagnosticsProvider?.updateDiagnostics(editor.document);
            vscode.window.showInformationMessage('KQL syntax check completed');
            // Small delay to ensure diagnostics are updated before checking
            setTimeout(() => checkSuccessAndShowFeedback(editor.document.uri), 100);
        } else {
            vscode.window.showWarningMessage('Please open a KQL file to check syntax');
        }
    });

    context.subscriptions.push(checkSyntaxCommand);

    // Register internal command to trigger feedback prompt (used by other providers)
    context.subscriptions.push(
        vscode.commands.registerCommand('kql-assistant.triggerFeedback', () => {
            showFeedbackPrompt();
        })
    );

    // Register command to select current query
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

            // Select from start of header to end of query
            const startPos = new vscode.Position(boundaries.startLine, 0);
            const endLine = editor.document.lineAt(boundaries.endLine);
            const endPos = new vscode.Position(boundaries.endLine, endLine.text.length);
            
            editor.selection = new vscode.Selection(startPos, endPos);
            editor.revealRange(new vscode.Range(startPos, endPos));
        })
    );

    // Register command to copy current query (without header)
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
            
            // This is a successful use of the extension
            showFeedbackPrompt();
        })
    );
}

export function deactivate() {
    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
        diagnosticsProvider = undefined;
    }
}

