import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAtomicMap, createMinimalAtomicMapSpec } from '../../packages/core/src/manager/map-generator.ts';
import { resolveCanonicalMapPaths, runMapIntegrationTest } from '../../packages/core/src/test-runner/map-integration.ts';
import { discoverMapsForAtom, runPropagationIntegration, shouldPropagateBehavior } from '../../packages/core/src/test-runner/propagation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-map-integration-'));
try {
  const created = generateAtomicMap({
    members: [{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }],
    edges: [],
    entrypoints: ['ATM-FIXTURE-0001'],
    qualityTargets: { requiredChecks: 1, promoteGateRequired: true }
  }, {
    repositoryRoot: tempRoot,
    now: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(created.ok, true);

  const canonical = runMapIntegrationTest(created.mapId, { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(canonical.ok, true);
  assert.equal(canonical.resolutionMode, 'canonical');
  assert.equal(existsSync(path.join(tempRoot, canonical.reportPath)), true);
  assert.equal(canonical.report.perMapStatus.length, 1);

  const legacySpec = createMinimalAtomicMapSpec({
    mapId: 'ATM-MAP-9301',
    mapVersion: '0.1.0',
    members: [{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }],
    edges: [],
    entrypoints: ['ATM-FIXTURE-0001'],
    qualityTargets: { requiredChecks: 1, promoteGateRequired: true }
  });
  const legacyWorkbench = path.join(tempRoot, 'atomic_workbench', 'atoms', 'ATM-LEGACY-0001', 'map');
  mkdirSync(legacyWorkbench, { recursive: true });
  writeFileSync(path.join(legacyWorkbench, 'map.spec.json'), `${JSON.stringify(legacySpec, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(legacyWorkbench, 'map.integration.test.ts'), "console.log('legacy map integration ok');\n", 'utf8');
  const legacy = runMapIntegrationTest('ATM-MAP-9301', { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.resolutionMode, 'legacy');
  assert.equal(legacy.warnings[0].startsWith('ATM_MAP_TEST_LEGACY_FALLBACK:'), true);
  assert.equal(existsSync(path.join(tempRoot, resolveCanonicalMapPaths('ATM-MAP-9301').reportPath)), true);

  const passFixture = readJson('fixtures/test-runner/map-propagation-pass.json');
  const failFixture = readJson('fixtures/test-runner/map-propagation-fail.json');
  writeCanonicalFixtureMap(tempRoot, passFixture, true);
  writeCanonicalFixtureMap(tempRoot, failFixture, false);

  const discovered = discoverMapsForAtom('ATM-FIXTURE-0001', { repositoryRoot: tempRoot });
  assert.equal(discovered.includes(created.mapId), true);
  assert.equal(discovered.includes(passFixture.mapId), true);
  assert.equal(discovered.includes(failFixture.mapId), true);

  const propagation = runPropagationIntegration('ATM-FIXTURE-0001', { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(propagation.ok, false);
  assert.equal(propagation.failedDownstream.includes(failFixture.mapId), true);
  assert.equal(propagation.perMapStatus.some((entry) => entry.mapId === passFixture.mapId && entry.ok === true), true);
  assert.equal(propagation.perMapStatus.some((entry) => entry.mapId === failFixture.mapId && entry.ok === false), true);
  assert.equal(shouldPropagateBehavior('split'), true);
  assert.equal(shouldPropagateBehavior('merge'), true);
  assert.equal(shouldPropagateBehavior('atomize'), true);
  assert.equal(shouldPropagateBehavior('infect'), true);
  assert.equal(shouldPropagateBehavior('patch'), false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[map-integration:test] ok (12 acceptance checks)');

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function writeCanonicalFixtureMap(repositoryRoot: any, fixture: any, shouldPass: any) {
  const spec = createMinimalAtomicMapSpec({
    mapId: fixture.mapId,
    mapVersion: '0.1.0',
    members: fixture.members,
    edges: fixture.edges,
    entrypoints: fixture.entrypoints,
    qualityTargets: fixture.qualityTargets
  });
  const paths = resolveCanonicalMapPaths(fixture.mapId);
  const workbenchPath = path.join(repositoryRoot, paths.workbenchPath);
  mkdirSync(workbenchPath, { recursive: true });
  writeFileSync(path.join(repositoryRoot, paths.specPath), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(repositoryRoot, paths.testPath), shouldPass
    ? `console.log(${JSON.stringify(`${fixture.mapId} propagation ok`)});\n`
    : `console.error(${JSON.stringify(`${fixture.mapId} propagation failed`)});\nprocess.exit(1);\n`, 'utf8');
}