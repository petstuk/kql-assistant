import * as vscode from 'vscode';
import * as path from 'path';
import { KqlSyntaxChecker, SyntaxError } from './syntaxChecker';
import { KqlSchemaValidator } from './schemaValidator';
import { extractYamlQueryBlocks, remapYamlQueryIssues } from './sentinelYaml';
import { applySeverityOverrides, isIgnoredPath, loadLintConfig } from './lintConfig';

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
        if (!isLintableDocument(document)) {
            return;
        }

        const config = vscode.workspace.getConfiguration('kqlAssistant');
        const enableDiagnostics = config.get<boolean>('enableDiagnostics', true);

        if (!enableDiagnostics) {
            this.diagnosticCollection.delete(document.uri);
            this.lastDiagnosticsByUri.delete(document.uri.toString());
            return;
        }

        const loaded =
            document.uri.scheme === 'file' ? loadLintConfig(path.dirname(document.fileName)) : { config: {} };
        const lintConfig = loaded.config;
        const ignoreRoot = loaded.path ? path.dirname(loaded.path) : path.dirname(document.fileName);
        if (
            document.uri.scheme === 'file' &&
            isIgnoredPath(document.fileName, ignoreRoot, lintConfig.ignorePatterns)
        ) {
            this.diagnosticCollection.delete(document.uri);
            this.lastDiagnosticsByUri.delete(document.uri.toString());
            return;
        }

        const ignoredTables = config.get<string[]>('ignoredTables', []) ?? [];
        this.syntaxChecker.setIgnoredTables(ignoredTables);

        const lintMode = config.get<string>('lintMode', 'basic');
        this.syntaxChecker.setLintMode(
            lintMode === 'strict' || lintMode === 'off' || lintMode === 'basic'
                ? lintMode
                : 'basic'
        );

        const text = document.getText();
        const errors = applySeverityOverrides(
            lintDocumentText(document, text, this.syntaxChecker),
            lintConfig.severity
        );
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
        } else if (error.severity === 'warning') {
            severity = vscode.DiagnosticSeverity.Warning;
        } else {
            severity = this.configLevelToSeverity(diagnosticLevel);
        }

        const diagnostic = new vscode.Diagnostic(range, error.message, severity);
        diagnostic.source = KQL_DIAGNOSTIC_SOURCE;
        if (error.code) {
            diagnostic.code = error.code;
        }
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

function isLintableDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'kql' || isYamlDocument(document);
}

function isYamlDocument(document: vscode.TextDocument): boolean {
    return (
        document.languageId === 'yaml' ||
        document.fileName.toLowerCase().endsWith('.yaml') ||
        document.fileName.toLowerCase().endsWith('.yml')
    );
}

function lintDocumentText(
    document: vscode.TextDocument,
    text: string,
    checker: KqlSyntaxChecker
): SyntaxError[] {
    if (!isYamlDocument(document)) {
        return checker.check(text);
    }
    const blocks = extractYamlQueryBlocks(text);
    return blocks.flatMap(block => remapYamlQueryIssues(block, checker.check(block.text)));
}
