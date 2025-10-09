import * as vscode from 'vscode';
import { KqlSyntaxChecker } from './syntaxChecker';
import { KqlSchemaValidator } from './schemaValidator';

export class KqlDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private syntaxChecker: KqlSyntaxChecker;

    constructor(private context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('kql');
        this.syntaxChecker = new KqlSyntaxChecker();
        
        // Initialize schema validator
        const schemaValidator = new KqlSchemaValidator(context);
        this.syntaxChecker.setSchemaValidator(schemaValidator);
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'kql') {
            return;
        }

        const config = vscode.workspace.getConfiguration('kqlAssistant');
        const enableDiagnostics = config.get<boolean>('enableDiagnostics', true);

        if (!enableDiagnostics) {
            this.diagnosticCollection.delete(document.uri);
            return;
        }

        const text = document.getText();
        const errors = this.syntaxChecker.check(text);
        const diagnosticLevel = config.get<string>('diagnosticLevel', 'error');

        const diagnostics: vscode.Diagnostic[] = errors.map(error => {
            const range = new vscode.Range(
                new vscode.Position(error.line, error.column),
                new vscode.Position(error.line, error.column + error.length)
            );

            let severity: vscode.DiagnosticSeverity;
            switch (diagnosticLevel) {
                case 'warning':
                    severity = vscode.DiagnosticSeverity.Warning;
                    break;
                case 'information':
                    severity = vscode.DiagnosticSeverity.Information;
                    break;
                default:
                    severity = vscode.DiagnosticSeverity.Error;
            }

            const diagnostic = new vscode.Diagnostic(range, error.message, severity);
            diagnostic.source = 'KQL Assistant';
            return diagnostic;
        });

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    public clearDiagnostics(document: vscode.TextDocument): void {
        this.diagnosticCollection.delete(document.uri);
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

