/**
 * Convert Azure CLI / getschema JSON into kqlAssistant.userSchemaPath format.
 * Does not call Azure — the user exports JSON offline, then this maps columns.
 */

export interface UserTableSchema {
    tableName: string;
    description: string;
    columns: Record<string, { type: string; description: string }>;
}

export type UserSchemaFile = Record<string, UserTableSchema>;

export interface ConvertSchemaOptions {
    /** Required when input is a getschema row array without table names */
    tableName?: string;
}

interface AzColumn {
    name?: string;
    type?: string;
    description?: string;
    displayName?: string;
}

interface AzTable {
    name?: string;
    description?: string;
    schema?: { columns?: AzColumn[]; name?: string };
    columns?: AzColumn[];
}

interface GetSchemaRow {
    ColumnName?: string;
    ColumnType?: string;
    DataType?: string;
    TableName?: string;
    name?: string;
    type?: string;
}

export function convertToUserSchema(input: unknown, options: ConvertSchemaOptions = {}): UserSchemaFile {
    if (isUserSchemaFile(input)) {
        return input;
    }

    const tables = unwrapTableList(input);
    if (tables) {
        const result: UserSchemaFile = {};
        for (const table of tables) {
            const converted = convertAzTable(table);
            if (converted) {
                result[converted.tableName] = converted;
            }
        }
        if (Object.keys(result).length > 0) {
            return result;
        }
    }

    const rows = unwrapGetschemaRows(input);
    if (rows) {
        return convertGetschemaRows(rows, options.tableName);
    }

    throw new Error(
        'Unrecognized schema JSON. Expected Azure CLI table-list output, getschema rows, or an existing user schema object.'
    );
}

function convertAzTable(table: AzTable): UserTableSchema | undefined {
    const tableName = table.name ?? table.schema?.name;
    if (!tableName) {
        return undefined;
    }
    const columns = table.schema?.columns ?? table.columns ?? [];
    return {
        tableName,
        description: table.description ?? `Exported table ${tableName}`,
        columns: columnsToMap(columns)
    };
}

function convertGetschemaRows(rows: GetSchemaRow[], fallbackTable?: string): UserSchemaFile {
    const grouped = new Map<string, GetSchemaRow[]>();
    for (const row of rows) {
        const tableName = row.TableName ?? fallbackTable;
        if (!tableName) {
            throw new Error('getschema JSON has no TableName; pass --table <Name>.');
        }
        const list = grouped.get(tableName) ?? [];
        list.push(row);
        grouped.set(tableName, list);
    }

    const result: UserSchemaFile = {};
    for (const [tableName, tableRows] of grouped) {
        const columns: UserTableSchema['columns'] = {};
        for (const row of tableRows) {
            const name = row.ColumnName ?? row.name;
            if (!name) {
                continue;
            }
            columns[name] = {
                type: normalizeType(row.ColumnType ?? row.DataType ?? row.type ?? 'string'),
                description: ''
            };
        }
        result[tableName] = {
            tableName,
            description: `Exported table ${tableName}`,
            columns
        };
    }
    return result;
}

function columnsToMap(columns: AzColumn[]): UserTableSchema['columns'] {
    const result: UserTableSchema['columns'] = {};
    for (const column of columns) {
        if (!column.name) {
            continue;
        }
        result[column.name] = {
            type: normalizeType(column.type ?? 'string'),
            description: column.description ?? column.displayName ?? ''
        };
    }
    return result;
}

function unwrapTableList(input: unknown): AzTable[] | undefined {
    if (Array.isArray(input) && input.every(item => item && typeof item === 'object' && ('schema' in item || 'columns' in item))) {
        return input as AzTable[];
    }
    if (input && typeof input === 'object') {
        const record = input as { value?: unknown };
        if (Array.isArray(record.value)) {
            return unwrapTableList(record.value);
        }
    }
    return undefined;
}

function unwrapGetschemaRows(input: unknown): GetSchemaRow[] | undefined {
    if (!Array.isArray(input) || input.length === 0) {
        return undefined;
    }
    const first = input[0] as GetSchemaRow;
    if (first && (first.ColumnName || first.ColumnType || (first.name && first.type && !('schema' in first)))) {
        return input as GetSchemaRow[];
    }
    return undefined;
}

function isUserSchemaFile(input: unknown): input is UserSchemaFile {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return false;
    }
    const values = Object.values(input as Record<string, unknown>);
    if (values.length === 0) {
        return false;
    }
    return values.every(
        value =>
            value &&
            typeof value === 'object' &&
            'tableName' in value &&
            'columns' in value &&
            typeof (value as UserTableSchema).columns === 'object'
    );
}

function normalizeType(type: string): string {
    const trimmed = type.replace(/^System\./i, '').toLowerCase();
    if (trimmed === 'datetime' || trimmed === 'date') {
        return 'datetime';
    }
    if (trimmed === 'int32' || trimmed === 'int64' || trimmed === 'int' || trimmed === 'long') {
        return trimmed.startsWith('int') && trimmed !== 'int64' ? 'int' : 'long';
    }
    if (trimmed === 'boolean' || trimmed === 'bool') {
        return 'bool';
    }
    if (trimmed === 'real' || trimmed === 'double' || trimmed === 'float') {
        return 'real';
    }
    if (trimmed === 'dynamic' || trimmed === 'object') {
        return 'dynamic';
    }
    if (trimmed === 'timespan' || trimmed === 'guid' || trimmed === 'decimal') {
        return trimmed;
    }
    return 'string';
}
