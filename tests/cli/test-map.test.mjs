import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMinimalAtomicMapSpec } from '../../packages/core/src/manager/map-generator.mjs';
import { resolveCanonicalMapPaths } from '../../packages/core/src/test-runner/map-integration.ts';
import { createTempWorkspace } from '../../scripts/temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-cli-test-map-');
const members = JSON.stringify([{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }]);
const entrypoints = JSON.stringify(['ATM-FIXTURE-0001']);
const qualityTargets = JSON.stringify({ requiredChecks: 1, promoteGateRequired: true });
try {
  const create = runAtm(['create-map', '--cwd', tempRoot, '--members', members, '--entrypoints', entrypoints, '--quality-targets', qualityTargets]);
  assert.equal(create.exitCode, 0);
  assert.equal(create.parsed.ok, true);

  const mapTest = runAtm(['test', '--cwd', tempRoot, '--map', 'ATM-MAP-0001']);
  assert.equal(mapTest.exitCode, 0);
  assert.equal(mapTest.parsed.ok, true);
  assert.equal(mapTest.parsed.evidence.mapId, 'ATM-MAP-0001');
  assert.equal(mapTest.parsed.evidence.resolutionMode, 'canonical');
  assert.equal(existsSync(path.join(tempRoot, mapTest.parsed.evidence.reportPath)), true);

  writeFailingMap(tempRoot, 'ATM-MAP-9202');
  const propagate = runAtm(['test', '--cwd', tempRoot, '--propagate', 'ATM-FIXTURE-0001']);
  assert.equal(propagate.exitCode, 1);
  assert.equal(propagate.parsed.ok, false);
  assert.equal(propagate.parsed.evidence.discoveredMaps.includes('ATM-MAP-0001'), true);
  assert.equal(propagate.parsed.evidence.failedDownstream.includes('ATM-MAP-9202'), true);

  const usage = runAtm(['test', '--cwd', tempRoot]);
  assert.equal(usage.exitCode, 2);
  assert.equal(usage.parsed.ok, false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-test-map:test] ok (4 acceptance checks)');

function runAtm(args) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse(payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}

function writeFailingMap(repositoryRoot, mapId) {
  const spec = createMinimalAtomicMapSpec({
    mapId,
    mapVersion: '0.1.0',
    members: [{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }],
    edges: [],
    entrypoints: ['ATM-FIXTURE-0001'],
    qualityTargets: { requiredChecks: 1, promoteGateRequired: true }
  });
  const paths = resolveCanonicalMapPaths(mapId);
  mkdirSync(path.join(repositoryRoot, paths.workbenchPath), { recursive: true });
  writeFileSync(path.join(repositoryRoot, paths.specPath), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(repositoryRoot, paths.testPath), "console.error('propagation failure fixture');\nprocess.exit(1);\n", 'utf8');
}
