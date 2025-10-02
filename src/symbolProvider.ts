import * as vscode from 'vscode';

export class KqlDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        const symbols: vscode.DocumentSymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Stack to track hierarchy of headers
        const symbolStack: { symbol: vscode.DocumentSymbol; level: number }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Match markdown headers: # Title # or # Title or ## Title ##, etc.
            const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+?)(?:\s+#{1,6})?\s*$/);
            
            if (headerMatch) {
                const level = headerMatch[1].length; // Number of # symbols
                const title = headerMatch[2].trim();
                
                // Calculate the range for this symbol
                const startPos = new vscode.Position(i, 0);
                // Initially set end to the same line, we'll adjust it later if needed
                const endPos = new vscode.Position(i, line.length);
                const range = new vscode.Range(startPos, endPos);
                
                // Selection range is just the header text itself
                const titleStartCol = line.indexOf(headerMatch[1]) + headerMatch[1].length;
                const selectionRange = new vscode.Range(
                    new vscode.Position(i, titleStartCol),
                    new vscode.Position(i, line.length)
                );

                // Determine symbol kind based on level
                let symbolKind: vscode.SymbolKind;
                switch (level) {
                    case 1: symbolKind = vscode.SymbolKind.Module; break;
                    case 2: symbolKind = vscode.SymbolKind.Class; break;
                    case 3: symbolKind = vscode.SymbolKind.Method; break;
                    case 4: symbolKind = vscode.SymbolKind.Function; break;
                    case 5: symbolKind = vscode.SymbolKind.Property; break;
                    case 6: symbolKind = vscode.SymbolKind.Field; break;
                    default: symbolKind = vscode.SymbolKind.String; break;
                }

                const symbol = new vscode.DocumentSymbol(
                    title,
                    '',
                    symbolKind,
                    range,
                    selectionRange
                );

                // Remove symbols from the stack that are at the same level or deeper
                while (symbolStack.length > 0 && symbolStack[symbolStack.length - 1].level >= level) {
                    symbolStack.pop();
                }

                // Add this symbol as a child of the parent in the stack, or to root
                if (symbolStack.length > 0) {
                    const parent = symbolStack[symbolStack.length - 1].symbol;
                    parent.children.push(symbol);
                } else {
                    symbols.push(symbol);
                }

                // Add this symbol to the stack for future children
                symbolStack.push({ symbol, level });
            }
        }

        return symbols;
    }
}

