export interface TextPosition {
    line: number;
    column: number;
}

export interface TextRange {
    start: TextPosition;
    end: TextPosition;
}

export interface ParsedPipe {
    operator: string;
    args: string;
    raw: string;
    line: number;
    column: number;
}

export interface ParsedQueryBlock {
    startLine: number;
    endLine: number;
    lines: string[];
    pipes: ParsedPipe[];
}

export interface ParseIssue {
    line: number;
    column: number;
    length: number;
    message: string;
}

export interface ParseResult {
    blocks: ParsedQueryBlock[];
    issues: ParseIssue[];
}

export function parseKqlDocument(text: string): ParseResult {
    const lines = text.split('\n');
    const blocks: ParsedQueryBlock[] = [];
    const issues: ParseIssue[] = [];
    let blockStart: number | undefined;
    let blockLines: string[] = [];

    const flushBlock = (endLine: number): void => {
        if (blockStart === undefined || blockLines.length === 0) {
            return;
        }
        blocks.push({
            startLine: blockStart,
            endLine,
            lines: blockLines,
            pipes: extractPipes(blockLines, blockStart, issues)
        });
        blockStart = undefined;
        blockLines = [];
    };

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const trimmed = line.trim();
        const isBoundary = trimmed === '' || trimmed.startsWith('#');

        if (isBoundary) {
            flushBlock(lineNum - 1);
            continue;
        }

        if (trimmed.startsWith('//')) {
            continue;
        }

        if (blockStart === undefined) {
            blockStart = lineNum;
        }
        blockLines.push(line);
    }

    flushBlock(lines.length - 1);

    return { blocks, issues };
}

export function stripLineComment(line: string): string {
    let quote: string | undefined;
    for (let i = 0; i < line.length - 1; i++) {
        const char = line[i];
        if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
            quote = quote === char ? undefined : quote ?? char;
        }
        if (!quote && char === '/' && line[i + 1] === '/') {
            return line.substring(0, i);
        }
    }
    return line;
}

export function splitTopLevelPipes(line: string): Array<{ text: string; column: number }> {
    const parts: Array<{ text: string; column: number }> = [];
    let quote: string | undefined;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
            quote = quote === char ? undefined : quote ?? char;
            continue;
        }
        if (quote) {
            continue;
        }
        if (char === '(') { parenDepth++; }
        if (char === ')' && parenDepth > 0) { parenDepth--; }
        if (char === '[') { bracketDepth++; }
        if (char === ']' && bracketDepth > 0) { bracketDepth--; }
        if (char === '{') { braceDepth++; }
        if (char === '}' && braceDepth > 0) { braceDepth--; }
        if (char === '|' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            parts.push({ text: line.substring(i + 1), column: i });
        }
    }

    return parts;
}

function extractPipes(blockLines: string[], startLine: number, issues: ParseIssue[]): ParsedPipe[] {
    const pipes: ParsedPipe[] = [];
    for (let offset = 0; offset < blockLines.length; offset++) {
        const line = stripLineComment(blockLines[offset]);
        const pipeParts = splitTopLevelPipes(line);
        for (let pipeIndex = 0; pipeIndex < pipeParts.length; pipeIndex++) {
            const pipe = pipeParts[pipeIndex];
            let rawText = pipe.text;
            if (pipeIndex === pipeParts.length - 1) {
                rawText = appendContinuationLines(rawText, blockLines, offset);
            }
            const raw = rawText.trim();
            const operatorMatch = raw.match(/^([a-zA-Z][\w-]*)\b([\s\S]*)$/);
            if (!operatorMatch) {
                issues.push({
                    line: startLine + offset,
                    column: pipe.column,
                    length: 1,
                    message: 'Pipe operator must be followed by a KQL operator'
                });
                continue;
            }
            pipes.push({
                operator: operatorMatch[1].toLowerCase(),
                args: operatorMatch[2].trim(),
                raw,
                line: startLine + offset,
                column: pipe.column
            });
        }
    }
    return pipes;
}

function appendContinuationLines(firstPipeText: string, blockLines: string[], offset: number): string {
    const rawLines = [firstPipeText];
    for (let next = offset + 1; next < blockLines.length; next++) {
        const candidate = stripLineComment(blockLines[next]);
        if (splitTopLevelPipes(candidate).length > 0) {
            break;
        }
        if (candidate.trim() === '') {
            break;
        }
        rawLines.push(candidate);
    }
    return rawLines.join('\n');
}
