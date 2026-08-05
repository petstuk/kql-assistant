import * as vscode from 'vscode';
import { KqlSyntaxChecker, SyntaxError } from './syntaxChecker';
import { KqlSchemaValidator } from './schemaValidator';

export const KQL_DIAGNOSTIC_SOURCE = 'KQL Assistant';

export class KqlDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private syntaxChecker: KqlSyntaxChecker;
    private lastDiagnosticsByUri: Map<string, vscode.Diagnostic[]> = new Map();

    constructor(_context: vscode.ExtensionContext, private schemaValidator: KqlSchemaValidator) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('kql');
        this.syntaxChecker = new KqlSyntaxChecker();
        this.syntaxChecker.setSchemaValidator(schemaValidator);
    }

    public reloadSchemas(): void {
        this.schemaValidator.reloadSchemas();
    }

    public updateDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId !== 'kql') {
            return;
        }

        const config = vscode.workspace.getConfiguration('kqlAssistant');
        const enableDiagnostics = config.get<boolean>('enableDiagnostics', true);

        if (!enableDiagnostics) {
            this.diagnosticCollection.delete(document.uri);
            this.lastDiagnosticsByUri.delete(document.uri.toString());
            return;
        }

        const ignoredTables = config.get<string[]>('ignoredTables', []) ?? [];
        this.syntaxChecker.setIgnoredTables(ignoredTables);

        const text = document.getText();
        const errors = this.syntaxChecker.check(text);
        const diagnosticLevel = config.get<string>('diagnosticLevel', 'error');
        const diagnostics = errors.map(error => this.toDiagnostic(error, diagnosticLevel));

        this.lastDiagnosticsByUri.set(document.uri.toString(), diagnostics);
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /** True when this extension has any diagnostic at or above the configured level */
    public hasOutstandingIssues(uri: vscode.Uri): boolean {
        const diagnostics = this.lastDiagnosticsByUri.get(uri.toString()) ?? [];
        const config = vscode.workspace.getConfiguration('kqlAssistant');
        const diagnosticLevel = config.get<string>('diagnosticLevel', 'error');

        const minSeverity = this.configLevelToSeverity(diagnosticLevel);
        return diagnostics.some(d => d.severity <= minSeverity);
    }

    public clearDiagnostics(document: vscode.TextDocument): void {
        this.diagnosticCollection.delete(document.uri);
        this.lastDiagnosticsByUri.delete(document.uri.toString());
    }

    public dispose(): void {
        this.diagnosticCollection.dispose();
        this.lastDiagnosticsByUri.clear();
    }

    private toDiagnostic(error: SyntaxError, diagnosticLevel: string): vscode.Diagnostic {
        const range = new vscode.Range(
            new vscode.Position(error.line, error.column),
            new vscode.Position(error.line, error.column + error.length)
        );

        let severity: vscode.DiagnosticSeverity;
        if (error.severity === 'information') {
            severity = vscode.DiagnosticSeverity.Information;
        } else {
            severity = this.configLevelToSeverity(diagnosticLevel);
        }

        const diagnostic = new vscode.Diagnostic(range, error.message, severity);
        diagnostic.source = KQL_DIAGNOSTIC_SOURCE;
        return diagnostic;
    }

    private configLevelToSeverity(diagnosticLevel: string): vscode.DiagnosticSeverity {
        switch (diagnosticLevel) {
            case 'warning':
                return vscode.DiagnosticSeverity.Warning;
            case 'information':
                return vscode.DiagnosticSeverity.Information;
            default:
                return vscode.DiagnosticSeverity.Error;
        }
    }
}
