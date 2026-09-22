import * as assert from 'assert';
import { convertToUserSchema } from '../src/schemaConvert';

describe('schemaConvert', () => {
    it('converts Azure CLI table-list JSON', () => {
        const schema = convertToUserSchema([
            {
                name: 'CustomAuth_CL',
                description: 'DCR custom table',
                schema: {
                    columns: [
                        { name: 'TimeGenerated', type: 'dateTime' },
                        { name: 'UserUpn', type: 'string', description: 'UPN' }
                    ]
                }
            }
        ]);
        assert.ok(schema.CustomAuth_CL);
        assert.strictEqual(schema.CustomAuth_CL.columns.TimeGenerated.type, 'datetime');
        assert.strictEqual(schema.CustomAuth_CL.columns.UserUpn.description, 'UPN');
    });

    it('converts getschema rows with --table', () => {
        const schema = convertToUserSchema(
            [
                { ColumnName: 'TimeGenerated', ColumnType: 'datetime' },
                { ColumnName: 'AlertId', ColumnType: 'string' }
            ],
            { tableName: 'CustomAlerts' }
        );
        assert.deepStrictEqual(Object.keys(schema.CustomAlerts.columns).sort(), ['AlertId', 'TimeGenerated']);
    });

    it('passes through existing user schema files', () => {
        const input = {
            CustomAlerts: {
                tableName: 'CustomAlerts',
                description: 'keep',
                columns: { AlertId: { type: 'string', description: '' } }
            }
        };
        assert.strictEqual(convertToUserSchema(input).CustomAlerts.description, 'keep');
    });
});
