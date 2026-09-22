import * as assert from 'assert';
import { findLetDefinition, findLetReferences } from '../src/letNavigation';
import { lookupMitre } from '../src/mitre';

const sample = `let Threshold = 5;
let Admins = datatable(User:string) ["a"];
SigninLogs
| where ResultType == Threshold
| where UserPrincipalName in (Admins)
`;

describe('letNavigation', () => {
    it('finds a let definition from a later reference', () => {
        const def = findLetDefinition(sample, 'Threshold', 3);
        assert.ok(def);
        assert.strictEqual(def!.line, 0);
        assert.ok(sample.split('\n')[0].includes('Threshold'));
    });

    it('finds all references including the definition', () => {
        const refs = findLetReferences(sample, 'Threshold', 3);
        assert.ok(refs.length >= 2);
        assert.ok(refs.some(ref => ref.line === 0));
        assert.ok(refs.some(ref => ref.line === 3));
    });
});

describe('mitre', () => {
    it('resolves tactics and common techniques', () => {
        const tactic = lookupMitre('TA0006');
        assert.strictEqual(tactic?.name, 'Credential Access');
        const technique = lookupMitre('T1110.001');
        assert.strictEqual(technique?.name, 'Password Guessing');
        assert.ok(technique?.url.includes('T1110'));
    });
});
