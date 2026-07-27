import assert from 'node:assert/strict';
import {
  createRunnerVersionRegistry,
  selectRunnerVersion,
  type PublishedRunnerVersion
} from '../../packages/core/src/broker/runner-version-registry.ts';
import {
  computeAggregateInputTreeHash,
  RUNNER_SYNC_ERROR_CODES,
  type RunnerInputGraphNode
} from '../../packages/core/src/broker/runner-version-contract.ts';

// Deterministic fixtures (ATM-GOV-0266 Phase A).
const SEAL_A = 'a'.repeat(40);
const SEAL_B = 'b'.repeat(40);
const SURFACES = ['packages/cli/dist', 'release/atm-onefile/atm.mjs', 'release/atm-root-drop'];

const nodes: readonly RunnerInputGraphNode[] = [
  { segment: 'packages', inputPaths: ['packages/core/src/x.ts'], inputDigest: 'sha256:pkgin', outputEntries: ['packages/core'], outputDigest: 'sha256:pkgout' },
  { segment: 'scripts', inputPaths: ['scripts/build.ts'], inputDigest: 'sha256:scin', outputEntries: ['release/atm-onefile/atm.mjs'], outputDigest: 'sha256:scout' }
];
const aggregate = computeAggregateInputTreeHash(nodes);

const published: readonly PublishedRunnerVersion[] = [
  { sealedSourceSha: SEAL_A, aggregateInputTreeHash: aggregate, publishedSurfaces: SURFACES, publishedAt: '2026-07-27T00:00:00.000Z' }
];
const registry = createRunnerVersionRegistry(published);

// 1. Exact sealed-source match covering surfaces.
{
  const selection = selectRunnerVersion(registry, { sealedSourceSha: SEAL_A, requiredSurfaces: SURFACES });
  assert.equal(selection.outcome, 'exact-seal-match');
  assert.equal(selection.errorCode, null);
  assert.deepEqual([...selection.selectedSurfaces].sort(), [...SURFACES].sort());
}

// 2. Aggregate-hash match: different sha, same input generation.
{
  const selection = selectRunnerVersion(registry, { sealedSourceSha: SEAL_B, aggregateInputTreeHash: aggregate, requiredSurfaces: SURFACES });
  assert.equal(selection.outcome, 'aggregate-hash-match');
  assert.equal(selection.errorCode, null);
}

// 3. Unknown seal + no aggregate → fail closed with seal-revalidation.
{
  const selection = selectRunnerVersion(registry, { sealedSourceSha: SEAL_B, requiredSurfaces: SURFACES });
  assert.equal(selection.outcome, 'seal-revalidation-required');
  assert.equal(selection.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
  assert.equal(selection.selectedSurfaces.length, 0);
}

// 4. Missing required surface → fail closed even on exact seal.
{
  const selection = selectRunnerVersion(registry, { sealedSourceSha: SEAL_A, requiredSurfaces: [...SURFACES, 'release/never-published'] });
  assert.equal(selection.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
}

// 5. Empty registry → no-candidate.
{
  const emptyRegistry = createRunnerVersionRegistry([]);
  const selection = selectRunnerVersion(emptyRegistry, { sealedSourceSha: SEAL_A, requiredSurfaces: SURFACES });
  assert.equal(selection.outcome, 'no-candidate');
  assert.equal(selection.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
}

console.log('runner-version-selection.test.ts: 5 assertions passed');
