import * as vscode from 'vscode';
import { KqlDiagnosticsProvider } from './diagnostics';
import { KqlCompletionProvider } from './completionProvider';
import { KqlDocumentSymbolProvider } from './symbolProvider';
import { KqlHoverProvider } from './hoverProvider';
import { KqlSignatureHelpProvider } from './signatureHelpProvider';

let diagnosticsProvider: KqlDiagnosticsProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('KQL Assistant extension is now active');

    // Create diagnostics provider
    diagnosticsProvider = new KqlDiagnosticsProvider();
    
    // Register completion provider for KQL
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'kql',
        new KqlCompletionProvider(),
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
        new KqlHoverProvider()
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
        } else {
            vscode.window.showWarningMessage('Please open a KQL file to check syntax');
        }
    });

    context.subscriptions.push(checkSyntaxCommand);
}

export function deactivate() {
    if (diagnosticsProvider) {
        diagnosticsProvider.dispose();
        diagnosticsProvider = undefined;
    }
}

