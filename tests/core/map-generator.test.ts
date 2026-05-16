import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateAtomicMap, createMinimalAtomicMapSpec } from '../../packages/core/src/manager/map-generator.ts';
import { computeAtomicMapHash } from '../../packages/core/src/registry/map-hash.ts';

if (process.argv.includes('--self-check')) {
  const spec = createMinimalAtomicMapSpec({
    mapId: 'ATM-MAP-9999',
    mapVersion: '0.1.0',
    members: [{ atomId: 'ATM-CORE-9999', version: '0.1.0' }],
    edges: [],
    entrypoints: ['ATM-CORE-9999'],
    qualityTargets: { requiredChecks: 1 }
  });
  assert.equal(spec.mapId, 'ATM-MAP-9999');
  assert.equal(spec.entrypoints[0], 'ATM-CORE-9999');
  assert.equal(spec.semanticFingerprint?.startsWith('sha256:') === true, true);

  const replacementSpec = createMinimalAtomicMapSpec({
    mapId: 'ATM-MAP-9998',
    mapVersion: '0.1.0',
    members: [
      { atomId: 'ATM-CORE-9998', version: '0.1.0', role: 'entry-adapter' },
      { atomId: 'ATM-CORE-9997', version: '0.1.0', role: 'domain-step' }
    ],
    edges: [{ from: 'ATM-CORE-9998', to: 'ATM-CORE-9997', binding: 'delegates', edgeKind: 'control-flow' }],
    entrypoints: ['ATM-CORE-9998'],
    qualityTargets: { requiredChecks: 1 },
    replacement: {
      legacyUris: ['legacy://samples/checkout-mini'],
      mode: 'draft',
      evidenceRefs: []
    }
  });
  assert.equal(replacementSpec.specVersion, '0.2.0');
  assert.equal(replacementSpec.members[0].role, 'entry-adapter');
  assert.equal(replacementSpec.edges[0].edgeKind, 'control-flow');
  assert.deepEqual(replacementSpec.replacement?.legacyUris, ['legacy://samples/checkout-mini']);
  assert.equal(replacementSpec.mapHash, computeAtomicMapHash({
    members: replacementSpec.members,
    edges: replacementSpec.edges,
    entrypoints: replacementSpec.entrypoints,
    replacement: replacementSpec.replacement
  }));
  assert.equal(replacementSpec.mapHash, computeAtomicMapHash({
    members: replacementSpec.members,
    edges: replacementSpec.edges,
    entrypoints: replacementSpec.entrypoints,
    replacement: {
      legacyUris: ['legacy://samples/checkout-mini'],
      mode: 'active',
      evidenceRefs: ['map-equivalence:sample']
    }
  }));
  assert.notEqual(replacementSpec.mapHash, computeAtomicMapHash({
    members: [
      { atomId: 'ATM-CORE-9998', version: '0.1.0', role: 'validator' },
      { atomId: 'ATM-CORE-9997', version: '0.1.0', role: 'domain-step' }
    ],
    edges: replacementSpec.edges,
    entrypoints: replacementSpec.entrypoints,
    replacement: replacementSpec.replacement
  }));
  console.log('[map-generator:self-check] ok');
  process.exit(0);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-map-generator-'));
const baseRequest = {
  members: [{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0' }],
  edges: [],
  entrypoints: ['ATM-FIXTURE-0001'],
  qualityTargets: {
    requiredChecks: 1,
    promoteGateRequired: true
  }
};

try {
  const dryRun = generateAtomicMap(baseRequest, { repositoryRoot: tempRoot, dryRun: true, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.mapId, 'ATM-MAP-0001');
  assert.equal(existsSync(path.join(tempRoot, 'atomic_workbench')), false);

  const first = generateAtomicMap(baseRequest, { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(first.ok, true);
  assert.equal(first.mapId, 'ATM-MAP-0001');
  assert.equal(first.allocation.sequence, 1);
  assert.equal(existsSync(path.join(tempRoot, first.specPath)), true);
  assert.equal(existsSync(path.join(tempRoot, first.testPath)), true);
  assert.equal(existsSync(path.join(tempRoot, first.reportPath)), true);
  assert.equal(existsSync(path.join(tempRoot, 'atomic-registry.json')), true);
  assert.equal(existsSync(path.join(tempRoot, 'atomic_workbench/registry-catalog.md')), true);

  const registry = JSON.parse(readFileSync(path.join(tempRoot, 'atomic-registry.json'), 'utf8'));
  const createdMapEntry = registry.entries.find((entry: any) => entry.mapId === 'ATM-MAP-0001');
  assert.ok(createdMapEntry);
  assert.equal(createdMapEntry.schemaId, 'atm.atomicMap');
  assert.equal(createdMapEntry.mapVersion, '0.1.0');
  assert.deepEqual(createdMapEntry.location, {
    specPath: 'atomic_workbench/maps/ATM-MAP-0001/map.spec.json',
    codePaths: [],
    testPaths: ['atomic_workbench/maps/ATM-MAP-0001/map.integration.test.ts'],
    reportPath: 'atomic_workbench/maps/ATM-MAP-0001/map.test.report.json',
    workbenchPath: 'atomic_workbench/maps/ATM-MAP-0001'
  });
  assert.deepEqual(createdMapEntry.evidence, [
    'generator-provenance:generated',
    'atomic_workbench/maps/ATM-MAP-0001/map.spec.json',
    'atomic_workbench/maps/ATM-MAP-0001/map.integration.test.ts',
    'atomic_workbench/maps/ATM-MAP-0001/map.test.report.json'
  ]);

  const idempotent = generateAtomicMap(baseRequest, { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(idempotent.ok, true);
  assert.equal(idempotent.idempotent, true);
  assert.equal(idempotent.mapId, 'ATM-MAP-0001');

  const next = generateAtomicMap({
    members: [
      { atomId: 'ATM-FIXTURE-0001', version: '0.1.0' },
      { atomId: 'ATM-FIXTURE-0002', version: '0.1.0' }
    ],
    edges: [
      { from: 'ATM-FIXTURE-0001', to: 'ATM-FIXTURE-0002', binding: 'feeds' }
    ],
    entrypoints: ['ATM-FIXTURE-0001'],
    qualityTargets: {
      requiredChecks: 2,
      promoteGateRequired: true
    }
  }, { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(next.ok, true);
  assert.equal(next.mapId, 'ATM-MAP-0002');

  const replacementMap = generateAtomicMap({
    members: [
      { atomId: 'ATM-FIXTURE-0001', version: '0.1.0', role: 'entry-adapter' },
      { atomId: 'ATM-FIXTURE-0002', version: '0.1.0', role: 'domain-step' }
    ],
    edges: [
      { from: 'ATM-FIXTURE-0001', to: 'ATM-FIXTURE-0002', binding: 'feeds', edgeKind: 'data-flow' }
    ],
    entrypoints: ['ATM-FIXTURE-0001'],
    qualityTargets: {
      requiredChecks: 2,
      promoteGateRequired: true
    },
    replacement: {
      legacyUris: ['legacy://samples/checkout-mini'],
      mode: 'draft',
      evidenceRefs: []
    }
  }, { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(replacementMap.ok, true);
  assert.equal(replacementMap.registryEntry.specVersion, '0.2.0');
  assert.equal(replacementMap.registryEntry.members[0].role, 'entry-adapter');
  assert.equal(replacementMap.registryEntry.edges[0].edgeKind, 'data-flow');
  assert.deepEqual(replacementMap.registryEntry.replacement.legacyUris, ['legacy://samples/checkout-mini']);

  const invalid = generateAtomicMap({ members: [], edges: [], entrypoints: [], qualityTargets: {} }, { repositoryRoot: tempRoot });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'ATM_MAP_GENERATOR_REQUEST_INVALID');

  writeFileSync(path.join(tempRoot, 'atomic-registry.json'), '{bad json', 'utf8');
  const invalidRegistry = generateAtomicMap(baseRequest, { repositoryRoot: tempRoot });
  assert.equal(invalidRegistry.ok, false);
  assert.equal(invalidRegistry.error.code, 'ATM_REGISTRY_INVALID');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[map-generator:test] ok (6 acceptance checks)');
