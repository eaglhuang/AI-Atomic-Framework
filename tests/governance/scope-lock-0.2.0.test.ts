import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScopeLockRecord } from '../../packages/core/src/governance/scope-lock.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const v010Fixture = readJson('tests/schema-fixtures/positive/governance-scope-lock.json');
const v010 = createScopeLockRecord(v010Fixture);
assert.equal(v010.specVersion, '0.1.0');
assert.equal('selectors' in v010, false);
assert.deepEqual(v010.files, ['.atm/tasks/ATM-FIXTURE-0007.md']);

const v020Fixture = readJson('tests/schema-fixtures/positive/governance-scope-lock-0.2-map-selector.json');
const v020 = createScopeLockRecord(v020Fixture);
assert.equal(v020.specVersion, '0.2.0');
assert.equal(v020.selectors?.mapId, 'ATM-MAP-9102');
assert.deepEqual(v020.selectors?.mapMembers, ['ATM-FIXTURE-0001', 'ATM-FIXTURE-0002']);
assert.deepEqual(v020.selectors?.mapEntrypoints, ['ATM-FIXTURE-0001']);
assert.deepEqual(v020.selectors?.legacyUris, ['legacy://samples/checkout-mini']);
assert.deepEqual(v020.selectors?.mapEdges, [{
  from: 'ATM-FIXTURE-0001',
  to: 'ATM-FIXTURE-0002',
  edgeKind: 'control-flow'
}]);

assert.throws(
  () => createScopeLockRecord(readJson('tests/schema-fixtures/negative/governance-scope-lock-selectors-require-v020.json')),
  /selectors require specVersion 0.2.0/
);

console.log('[scope-lock-0.2.0:test] ok (0.1 round-trip, 0.2 selectors, invalid selector version)');

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}