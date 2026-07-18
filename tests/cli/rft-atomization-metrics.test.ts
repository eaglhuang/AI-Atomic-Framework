import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectRftAtomizationMetrics } from '../../scripts/validate-rft-atomization-metrics.ts';

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-rft-atomization-'));
mkdirSync(path.join(fixtureRoot, 'scripts'), { recursive: true });
mkdirSync(path.join(fixtureRoot, 'tests/cli'), { recursive: true });
mkdirSync(path.join(fixtureRoot, 'atomic_workbench/atomization-coverage'), { recursive: true });
mkdirSync(path.join(fixtureRoot, '.atm'), { recursive: true });

writeFileSync(path.join(fixtureRoot, '.atm/config.json'), JSON.stringify({ atomization: { maxLines: 600 } }, null, 2));
writeFileSync(path.join(fixtureRoot, 'scripts/owned.ts'), 'export const owned = true;\n');
writeFileSync(path.join(fixtureRoot, 'scripts/partial.ts'), 'export const partial = true;\n');
writeFileSync(path.join(fixtureRoot, 'tests/cli/missing-owner.test.ts'), 'export const missing = true;\n');
writeFileSync(path.join(fixtureRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map.json'), JSON.stringify({
  schemaId: 'atm.pathToAtomMap.v1',
  mappings: [
    { path_pattern: 'scripts/owned.ts', atom_id: 'atm.owned-map', coverage_status: 'active' },
    { path_pattern: 'scripts/partial.ts', atom_id: 'atm.partial-map', coverage_status: 'partial', source_task: 'TASK-RFT-0001' }
  ]
}, null, 2));

const healthy = inspectRftAtomizationMetrics(fixtureRoot, {
  touchedFiles: ['scripts/owned.ts'],
  taskId: 'TASK-RFT-0099'
});

assert.equal(healthy.ok, true);
assert.equal(healthy.schemaId, 'atm.rftAtomizationMetrics.v1');
assert.equal(healthy.touchedSourceCount, 1);
assert.equal(healthy.extractedAtomCount, 1);
assert.equal(healthy.inlineExceptionCount, 0);
assert.equal(healthy.followUpCardCount, 0);
assert.deepEqual(healthy.filesLackingAtomizationOwnership, []);
assert.equal(healthy.physicalGate.hardViolationCount, 0);

const warningSample = inspectRftAtomizationMetrics(fixtureRoot, {
  touchedFiles: ['scripts/partial.ts', 'tests/cli/missing-owner.test.ts'],
  taskId: 'TASK-RFT-0099'
});

assert.equal(warningSample.ok, true);
assert.equal(warningSample.touchedSourceCount, 2);
assert.equal(warningSample.extractedAtomCount, 1);
assert.equal(warningSample.inlineExceptionCount, 1);
assert.equal(warningSample.followUpCardCount, 1);
assert.deepEqual(warningSample.filesLackingAtomizationOwnership, ['tests/cli/missing-owner.test.ts']);
assert.equal(warningSample.semanticWarningCount, 3);
assert.equal(warningSample.physicalGate.hardViolationCount, 0);

console.log('[rft-atomization-metrics] ok healthy and warning samples passed');
