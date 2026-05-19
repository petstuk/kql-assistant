import * as vscode from 'vscode';
import * as path from 'path';
import { SchemaStore, ColumnSchema, TableSchema } from './schemaStore';

export type { ColumnSchema, TableSchema };

export interface SchemaValidatorOptions {
    bundledSchemaPath: string;
    userSchemaPath?: string;
}

export class KqlSchemaValidator {
    private store: SchemaStore;
    private readonly useWorkspaceConfig: boolean;

    constructor(context: vscode.ExtensionContext);
    constructor(options: SchemaValidatorOptions);
    constructor(contextOrOptions: vscode.ExtensionContext | SchemaValidatorOptions) {
        if ('bundledSchemaPath' in contextOrOptions) {
            this.useWorkspaceConfig = false;
            this.store = new SchemaStore(
                contextOrOptions.bundledSchemaPath,
                contextOrOptions.userSchemaPath
            );
        } else {
            this.useWorkspaceConfig = true;
            const bundledSchemaPath = path.join(contextOrOptions.extensionPath, 'schemas', 'all-tables.json');
            this.store = new SchemaStore(bundledSchemaPath, this.resolveUserSchemaPath());
        }
        console.log(`Loaded ${this.store.getTableCount()} table schemas`);
    }

    public reloadSchemas(): void {
        const userPath = this.useWorkspaceConfig ? this.resolveUserSchemaPath() : undefined;
        this.store.reload(userPath);
        console.log(`Loaded ${this.store.getTableCount()} table schemas`);
    }

    private resolveUserSchemaPath(): string | undefined {
        const configured = vscode.workspace
            .getConfiguration('kqlAssistant')
            .get<string>('userSchemaPath', '')
            .trim();
        if (!configured) {
            return undefined;
        }
        if (path.isAbsolute(configured)) {
            return configured;
        }
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            return undefined;
        }
        return path.join(folders[0].uri.fsPath, configured);
    }

    public validateTableExists(tableName: string): boolean {
        return this.store.validateTableExists(tableName);
    }

    public getTableSchema(tableName: string): TableSchema | undefined {
        return this.store.getTableSchema(tableName);
    }

    public validateColumn(tableName: string, columnName: string): boolean {
        return this.store.validateColumn(tableName, columnName);
    }

    public getColumnType(tableName: string, columnName: string): string | undefined {
        return this.store.getColumnType(tableName, columnName);
    }

    public getColumns(tableName: string): string[] {
        return this.store.getColumns(tableName);
    }

    public suggestColumns(tableName: string, prefix: string): Array<{ label: string; type: string; description: string }> {
        return this.store.suggestColumns(tableName, prefix);
    }

    public suggestSimilarTable(tableName: string): string | undefined {
        return this.store.suggestSimilarTable(tableName);
    }

    public getAllTableNames(): string[] {
        return this.store.getAllTableNames();
    }

    public getTableDescription(tableName: string): string | undefined {
        return this.store.getTableDescription(tableName);
    }

    public getCanonicalTableName(name: string): string | undefined {
        return this.store.getCanonicalTableName(name);
    }
}
