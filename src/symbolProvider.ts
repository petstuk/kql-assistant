import * as vscode from 'vscode';

export class KqlDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        const symbols: vscode.DocumentSymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // First pass: collect all headers with their line numbers
        const headers: { line: number; level: number; title: string; text: string }[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Match markdown headers: # Title # or ## Title ##, etc.
            const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+?)(?:\s+#{1,6})?\s*$/);
            
            if (headerMatch) {
                const level = headerMatch[1].length;
                const title = headerMatch[2].trim();
                headers.push({ line: i, level, title, text: line });
            }
        }

        // Second pass: create symbols with proper ranges
        const symbolStack: { symbol: vscode.DocumentSymbol; level: number; startLine: number }[] = [];

        for (let idx = 0; idx < headers.length; idx++) {
            const header = headers[idx];
            const nextHeader = headers[idx + 1];

            // Find the end line for this header's content
            let endLine: number;
            if (nextHeader) {
                // End at the line before the next header of same or higher level
                endLine = nextHeader.line - 1;
                // Trim trailing empty lines
                while (endLine > header.line && lines[endLine].trim() === '') {
                    endLine--;
                }
            } else {
                // Last header - extend to end of document
                endLine = lines.length - 1;
                while (endLine > header.line && lines[endLine].trim() === '') {
                    endLine--;
                }
            }

            const startPos = new vscode.Position(header.line, 0);
            const endPos = new vscode.Position(endLine, lines[endLine]?.length || 0);
            const range = new vscode.Range(startPos, endPos);
            
            // Selection range is just the header line
            const selectionRange = new vscode.Range(
                new vscode.Position(header.line, 0),
                new vscode.Position(header.line, header.text.length)
            );

            // Determine symbol kind and detail based on level
            let symbolKind: vscode.SymbolKind;
            let detail: string;
            switch (header.level) {
                case 1: 
                    symbolKind = vscode.SymbolKind.Module; 
                    detail = 'Category';
                    break;
                case 2: 
                    symbolKind = vscode.SymbolKind.Class; 
                    detail = 'Detection Rule';
                    break;
                case 3: 
                    symbolKind = vscode.SymbolKind.Method; 
                    detail = 'Query Section';
                    break;
                default: 
                    symbolKind = vscode.SymbolKind.Function; 
                    detail = 'Section';
                    break;
            }

            const symbol = new vscode.DocumentSymbol(
                header.title,
                detail,
                symbolKind,
                range,
                selectionRange
            );

            // Remove symbols from the stack that are at the same level or deeper
            while (symbolStack.length > 0 && symbolStack[symbolStack.length - 1].level >= header.level) {
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
            symbolStack.push({ symbol, level: header.level, startLine: header.line });
        }

        return symbols;
    }
}
