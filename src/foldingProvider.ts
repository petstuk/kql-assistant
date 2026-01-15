import * as vscode from 'vscode';

/**
 * Provides folding ranges for KQL files based on header markers:
 * - `# Category #` - Top-level categories
 * - `## Rule ##` - Individual detection rules/queries
 */
export class KqlFoldingRangeProvider implements vscode.FoldingRangeProvider {

    provideFoldingRanges(
        document: vscode.TextDocument,
        context: vscode.FoldingContext,
        token: vscode.CancellationToken
    ): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];
        const lines = document.lineCount;

        // Track open sections
        const stack: { level: number; startLine: number }[] = [];

        for (let i = 0; i < lines; i++) {
            const lineText = document.lineAt(i).text.trim();

            // Check for category header: # Name # (but not ## Name ##)
            const categoryMatch = lineText.match(/^#\s+[^#].*[^#]\s*#$/);
            // Check for rule header: ## Name ##
            const ruleMatch = lineText.match(/^##\s+.*\s+##$/);

            let currentLevel = 0;
            if (categoryMatch) {
                currentLevel = 1; // Category
            } else if (ruleMatch) {
                currentLevel = 2; // Rule
            }

            if (currentLevel > 0) {
                // Close any sections at same or deeper level
                while (stack.length > 0 && stack[stack.length - 1].level >= currentLevel) {
                    const section = stack.pop()!;
                    // End the range at the line before this header (or at least at the start line)
                    const endLine = Math.max(section.startLine, i - 1);
                    // Only create range if there's content to fold
                    if (endLine > section.startLine) {
                        ranges.push(new vscode.FoldingRange(
                            section.startLine,
                            endLine,
                            currentLevel === 1 ? vscode.FoldingRangeKind.Region : vscode.FoldingRangeKind.Region
                        ));
                    }
                }

                // Start a new section
                stack.push({ level: currentLevel, startLine: i });
            }
        }

        // Close any remaining open sections at end of document
        while (stack.length > 0) {
            const section = stack.pop()!;
            // Find the last non-empty line
            let endLine = lines - 1;
            while (endLine > section.startLine && document.lineAt(endLine).text.trim() === '') {
                endLine--;
            }
            if (endLine > section.startLine) {
                ranges.push(new vscode.FoldingRange(
                    section.startLine,
                    endLine,
                    vscode.FoldingRangeKind.Region
                ));
            }
        }

        return ranges;
    }
}

/**
 * Helper function to find the query boundaries for a given line
 * Returns the start line (header) and end line (last line of query)
 */
export function findQueryBoundaries(
    document: vscode.TextDocument,
    lineNumber: number
): { startLine: number; endLine: number; headerLine: number } | undefined {
    const lines = document.lineCount;

    // Find the header for the current position by scanning backwards
    let headerLine = -1;
    let headerLevel = 0;

    for (let i = lineNumber; i >= 0; i--) {
        const lineText = document.lineAt(i).text.trim();
        
        // Check for rule header: ## Name ##
        if (lineText.match(/^##\s+.*\s+##$/)) {
            headerLine = i;
            headerLevel = 2;
            break;
        }
        // Check for category header: # Name # (but not ##)
        if (lineText.match(/^#\s+[^#].*[^#]\s*#$/)) {
            headerLine = i;
            headerLevel = 1;
            break;
        }
    }

    if (headerLine === -1) {
        // No header found - might be before any headers
        // Look for the first header going forward
        return undefined;
    }

    // Find the end of this section
    let endLine = headerLine;
    for (let i = headerLine + 1; i < lines; i++) {
        const lineText = document.lineAt(i).text.trim();
        
        // Check if we hit another header at same or higher level
        const isCategory = lineText.match(/^#\s+[^#].*[^#]\s*#$/);
        const isRule = lineText.match(/^##\s+.*\s+##$/);

        if (isCategory) {
            // Always stop at category
            break;
        }
        if (isRule && headerLevel === 2) {
            // Stop at next rule if we're in a rule
            break;
        }

        // Include this line if it's not empty or if there's more content after
        if (lineText !== '' || hasMoreContent(document, i, headerLevel)) {
            endLine = i;
        }
    }

    // Trim trailing empty lines
    while (endLine > headerLine && document.lineAt(endLine).text.trim() === '') {
        endLine--;
    }

    return {
        startLine: headerLine,
        endLine: endLine,
        headerLine: headerLine
    };
}

/**
 * Check if there's more non-header content after the given line
 */
function hasMoreContent(document: vscode.TextDocument, startLine: number, currentLevel: number): boolean {
    for (let i = startLine + 1; i < document.lineCount; i++) {
        const lineText = document.lineAt(i).text.trim();
        if (lineText === '') continue;
        
        // Check if it's a header
        const isCategory = lineText.match(/^#\s+[^#].*[^#]\s*#$/);
        const isRule = lineText.match(/^##\s+.*\s+##$/);
        
        if (isCategory || (isRule && currentLevel === 2)) {
            return false;
        }
        
        // Found non-empty, non-header content
        return true;
    }
    return false;
}

/**
 * Get the query text for a given section
 */
export function getQueryText(document: vscode.TextDocument, lineNumber: number): string | undefined {
    const boundaries = findQueryBoundaries(document, lineNumber);
    if (!boundaries) {
        return undefined;
    }

    // Get text from the line after the header to the end
    const startLine = boundaries.headerLine + 1;
    const endLine = boundaries.endLine;

    if (startLine > endLine) {
        return undefined;
    }

    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
        lines.push(document.lineAt(i).text);
    }

    // Trim leading and trailing empty lines from the content
    while (lines.length > 0 && lines[0].trim() === '') {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    return lines.join('\n');
}
