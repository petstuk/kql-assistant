import * as assert from 'assert';
import * as path from 'path';
import { SchemaStore } from '../src/schemaStore';

const repoRoot = path.join(__dirname, '..', '..');
const bundledSchemaPath = path.join(repoRoot, 'schemas', 'all-tables.json');
const packsDir = path.join(repoRoot, 'schemas', 'packs');

describe('SchemaStore packs', () => {
    it('loads full catalog by default including ASIM parser stubs', () => {
        const store = new SchemaStore(bundledSchemaPath);
        assert.ok(store.getTableCount() >= 721);
        assert.ok(store.validateTableExists('SecurityAlert'));
        assert.ok(store.validateTableExists('_Im_NetworkSession'));
        assert.ok(store.validateColumn('_Im_NetworkSession', 'SrcIpAddr'));
    });

    it('filters to mde pack tables', () => {
        const store = new SchemaStore(bundledSchemaPath, undefined, {
            schemaPacks: ['mde'],
            packsDir
        });
        assert.ok(store.validateTableExists('DeviceProcessEvents'));
        assert.ok(!store.validateTableExists('SecurityAlert'));
        assert.ok(!store.validateTableExists('_Im_NetworkSession'));
    });

    it('unions sentinel-core and mde packs', () => {
        const store = new SchemaStore(bundledSchemaPath, undefined, {
            schemaPacks: ['sentinel-core', 'mde'],
            packsDir
        });
        assert.ok(store.validateTableExists('SecurityAlert'));
        assert.ok(store.validateTableExists('DeviceProcessEvents'));
        assert.ok(!store.validateTableExists('StormEvents'));
    });

    it('loads asim-parsers stubs when pack selected', () => {
        const store = new SchemaStore(bundledSchemaPath, undefined, {
            schemaPacks: ['asim-parsers'],
            packsDir
        });
        assert.ok(store.validateTableExists('_Im_Dns'));
        assert.ok(store.validateTableExists('_Im_ProcessEvent'));
        assert.ok(!store.validateTableExists('DeviceProcessEvents'));
    });
});
