import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateAtomicMap } from '../packages/core/src/manager/map-generator.mjs';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-map-template-'));
const now = '2026-01-01T00:00:00.000Z';
const request = {
  members: [{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }],
  edges: [],
  entrypoints: ['ATM-FIXTURE-0001'],
  qualityTargets: {
    requiredChecks: 1,
    promoteGateRequired: true
  }
};

try {
  const dryRun = generateAtomicMap(request, {
    repositoryRoot: tempRoot,
    dryRun: true,
    now
  });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.mapId, 'ATM-MAP-0001');
  assert.equal(dryRun.workbenchPath, 'atomic_workbench/maps/ATM-MAP-0001');
  assert.equal(dryRun.specPath, 'atomic_workbench/maps/ATM-MAP-0001/map.spec.json');
  assert.equal(dryRun.testPath, 'atomic_workbench/maps/ATM-MAP-0001/map.integration.test.mjs');
  assert.equal(dryRun.reportPath, 'atomic_workbench/maps/ATM-MAP-0001/map.test.report.json');
  assert.equal(existsSync(path.join(tempRoot, dryRun.workbenchPath)), false);

  const generated = generateAtomicMap(request, {
    repositoryRoot: tempRoot,
    now
  });
  assert.equal(generated.ok, true);
  assert.equal(generated.idempotent, false);
  assert.equal(existsSync(path.join(tempRoot, generated.specPath)), true);
  assert.equal(existsSync(path.join(tempRoot, generated.testPath)), true);
  assert.equal(existsSync(path.join(tempRoot, generated.reportPath)), true);

  const spec = JSON.parse(readFileSync(path.join(tempRoot, generated.specPath), 'utf8'));
  assert.equal(spec.mapId, 'ATM-MAP-0001');

  const testSource = readFileSync(path.join(tempRoot, generated.testPath), 'utf8');
  assert.equal(testSource.includes("new URL('./map.spec.json', import.meta.url)"), true);

  const report = JSON.parse(readFileSync(path.join(tempRoot, generated.reportPath), 'utf8'));
  assert.equal(report.ok, true);
  assert.deepEqual(report.command, [process.execPath, 'atomic_workbench/maps/ATM-MAP-0001/map.integration.test.mjs']);

  const registry = JSON.parse(readFileSync(path.join(tempRoot, 'atomic-registry.json'), 'utf8'));
  const entry = registry.entries.find((item) => item.mapId === 'ATM-MAP-0001');
  assert.ok(entry);
  assert.deepEqual(entry.location, {
    specPath: 'atomic_workbench/maps/ATM-MAP-0001/map.spec.json',
    codePaths: [],
    testPaths: ['atomic_workbench/maps/ATM-MAP-0001/map.integration.test.mjs'],
    reportPath: 'atomic_workbench/maps/ATM-MAP-0001/map.test.report.json',
    workbenchPath: 'atomic_workbench/maps/ATM-MAP-0001'
  });
  assert.deepEqual(entry.evidence, [
    'generator-provenance:generated',
    'atomic_workbench/maps/ATM-MAP-0001/map.spec.json',
    'atomic_workbench/maps/ATM-MAP-0001/map.integration.test.mjs',
    'atomic_workbench/maps/ATM-MAP-0001/map.test.report.json'
  ]);

  const idempotent = generateAtomicMap(request, {
    repositoryRoot: tempRoot,
    now
  });
  assert.equal(idempotent.ok, true);
  assert.equal(idempotent.idempotent, true);
  assert.equal(idempotent.mapId, 'ATM-MAP-0001');
  assert.equal(idempotent.specPath, generated.specPath);
  assert.equal(idempotent.testPath, generated.testPath);
  assert.equal(idempotent.reportPath, generated.reportPath);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`[map-template:${mode}] ok (14 acceptance checks)`);
