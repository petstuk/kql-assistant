import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ColumnSchema {
    type: string;
    description: string;
}

export interface TableSchema {
    tableName: string;
    description: string;
    columns: { [key: string]: ColumnSchema };
}

export class KqlSchemaValidator {
    private schemas: Map<string, TableSchema> = new Map();
    private tableNamesLower: Map<string, string> = new Map(); // lowercase -> actual name

    constructor(private context: vscode.ExtensionContext) {
        this.loadSchemas();
    }

    private loadSchemas(): void {
        try {
            const schemasPath = path.join(this.context.extensionPath, 'schemas', 'all-tables.json');
            
            if (!fs.existsSync(schemasPath)) {
                console.warn('Schema file not found:', schemasPath);
                return;
            }

            const schemasData = fs.readFileSync(schemasPath, 'utf8');
            const schemasJson = JSON.parse(schemasData);

            for (const [tableName, schema] of Object.entries(schemasJson)) {
                this.schemas.set(tableName, schema as TableSchema);
                this.tableNamesLower.set(tableName.toLowerCase(), tableName);
            }

            console.log(`Loaded ${this.schemas.size} table schemas`);
        } catch (error) {
            console.error('Failed to load schemas:', error);
        }
    }

    public validateTableExists(tableName: string): boolean {
        return this.schemas.has(tableName) || this.tableNamesLower.has(tableName.toLowerCase());
    }

    public getTableSchema(tableName: string): TableSchema | undefined {
        // Try exact match first
        let schema = this.schemas.get(tableName);
        if (schema) return schema;

        // Try case-insensitive match
        const actualName = this.tableNamesLower.get(tableName.toLowerCase());
        if (actualName) {
            return this.schemas.get(actualName);
        }

        return undefined;
    }

    public validateColumn(tableName: string, columnName: string): boolean {
        const schema = this.getTableSchema(tableName);
        if (!schema) return false;

        // Check exact match
        if (schema.columns.hasOwnProperty(columnName)) return true;

        // Check case-insensitive match
        const columnsLower = Object.keys(schema.columns).map(c => c.toLowerCase());
        return columnsLower.includes(columnName.toLowerCase());
    }

    public getColumnType(tableName: string, columnName: string): string | undefined {
        const schema = this.getTableSchema(tableName);
        if (!schema) return undefined;

        // Try exact match
        if (schema.columns[columnName]) {
            return schema.columns[columnName].type;
        }

        // Try case-insensitive match
        for (const [colName, colSchema] of Object.entries(schema.columns)) {
            if (colName.toLowerCase() === columnName.toLowerCase()) {
                return colSchema.type;
            }
        }

        return undefined;
    }

    public getColumns(tableName: string): string[] {
        const schema = this.getTableSchema(tableName);
        if (!schema) return [];
        return Object.keys(schema.columns);
    }

    public suggestColumns(tableName: string, prefix: string): Array<{label: string; type: string; description: string}> {
        const schema = this.getTableSchema(tableName);
        if (!schema) return [];

        const lowerPrefix = prefix.toLowerCase();
        const suggestions: Array<{label: string; type: string; description: string}> = [];

        for (const [colName, colSchema] of Object.entries(schema.columns)) {
            if (colName.toLowerCase().startsWith(lowerPrefix)) {
                suggestions.push({
                    label: colName,
                    type: colSchema.type,
                    description: colSchema.description
                });
            }
        }

        return suggestions;
    }

    public suggestSimilarTable(tableName: string): string | undefined {
        const lowerName = tableName.toLowerCase();
        let bestMatch: string | undefined;
        let minDistance = Infinity;

        for (const actualName of this.schemas.keys()) {
            const distance = this.levenshteinDistance(lowerName, actualName.toLowerCase());
            
            // Only suggest if reasonably similar (distance < 5)
            if (distance < minDistance && distance < 5) {
                minDistance = distance;
                bestMatch = actualName;
            }
        }

        return bestMatch;
    }

    public getAllTableNames(): string[] {
        return Array.from(this.schemas.keys());
    }

    public getTableDescription(tableName: string): string | undefined {
        const schema = this.getTableSchema(tableName);
        return schema?.description;
    }

    // Levenshtein distance for typo detection
    private levenshteinDistance(a: string, b: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }
}

