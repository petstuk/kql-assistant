import * as vscode from 'vscode';
import { findLetDefinition, findLetReferences } from './letNavigation';

const WORD = /[A-Za-z_]\w*/;

export class KqlLetDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Definition> {
        const word = wordAt(document, position);
        if (!word) {
            return undefined;
        }
        const def = findLetDefinition(document.getText(), word.name, position.line);
        if (!def) {
            return undefined;
        }
        return new vscode.Location(
            document.uri,
            new vscode.Range(def.line, def.column, def.line, def.column + def.length)
        );
    }
}

export class KqlLetReferenceProvider implements vscode.ReferenceProvider {
    provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Location[]> {
        const word = wordAt(document, position);
        if (!word) {
            return [];
        }
        return findLetReferences(document.getText(), word.name, position.line).map(
            ref =>
                new vscode.Location(
                    document.uri,
                    new vscode.Range(ref.line, ref.column, ref.line, ref.column + ref.length)
                )
        );
    }
}

export class KqlLetRenameProvider implements vscode.RenameProvider {
    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.ProviderResult<vscode.Range> {
        const word = wordAt(document, position);
        if (!word) {
            throw new Error('No let binding at cursor');
        }
        const def = findLetDefinition(document.getText(), word.name, position.line);
        if (!def) {
            throw new Error(`'${word.name}' is not a let binding in this query`);
        }
        return new vscode.Range(word.line, word.column, word.line, word.column + word.length);
    }

    provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string
    ): vscode.ProviderResult<vscode.WorkspaceEdit> {
        if (!/^[A-Za-z_]\w*$/.test(newName)) {
            throw new Error('Let names must be identifiers (letters, digits, underscore)');
        }
        const word = wordAt(document, position);
        if (!word) {
            return undefined;
        }
        const edit = new vscode.WorkspaceEdit();
        for (const ref of findLetReferences(document.getText(), word.name, position.line)) {
            edit.replace(
                document.uri,
                new vscode.Range(ref.line, ref.column, ref.line, ref.column + ref.length),
                newName
            );
        }
        return edit;
    }
}

function wordAt(
    document: vscode.TextDocument,
    position: vscode.Position
): { name: string; line: number; column: number; length: number } | undefined {
    const range = document.getWordRangeAtPosition(position, WORD);
    if (!range) {
        return undefined;
    }
    return {
        name: document.getText(range),
        line: range.start.line,
        column: range.start.character,
        length: range.end.character - range.start.character
    };
}
