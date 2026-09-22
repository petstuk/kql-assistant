import { buildQueryModel, findBlockAtLine, LetBinding } from './queryModel';

export interface LetLocation {
    name: string;
    line: number;
    column: number;
    length: number;
}

export function findLetDefinition(text: string, name: string, line: number): LetLocation | undefined {
    const binding = findBindingAtLine(text, name, line);
    if (!binding) {
        return undefined;
    }
    return {
        name: binding.name,
        line: binding.line,
        column: binding.column ?? 0,
        length: binding.name.length
    };
}

export function findLetReferences(text: string, name: string, line: number): LetLocation[] {
    const model = buildQueryModel(text);
    const block = findBlockAtLine(model, line);
    if (!block) {
        return [];
    }
    const binding = block.letBindings.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!binding) {
        return [];
    }

    const lines = text.split('\n');
    const needle = binding.name;
    const pattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'gi');
    const refs: LetLocation[] = [];

    for (let i = block.startLine; i <= block.endLine && i < lines.length; i++) {
        const lineText = lines[i];
        if (/^\s*\/\//.test(lineText) || /^\s*#/.test(lineText)) {
            continue;
        }
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(lineText)) !== null) {
            refs.push({
                name: match[0],
                line: i,
                column: match.index,
                length: match[0].length
            });
        }
    }
    return refs;
}

function findBindingAtLine(text: string, name: string, line: number): LetBinding | undefined {
    const model = buildQueryModel(text);
    const block = findBlockAtLine(model, line);
    const bindings = block?.letBindings ?? model.blocks.flatMap(item => item.letBindings);
    return bindings.find(item => item.name.toLowerCase() === name.toLowerCase());
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
