import assert from 'node:assert/strict';
import {
  createRunnerVersionRegistry,
  selectRunnerVersion,
  type PublishedRunnerVersion
} from '../../packages/core/src/broker/runner-version-registry.ts';
import {
  computeAggregateInputTreeHash,
  RUNNER_SYNC_ERROR_CODES,
  type RunnerInputGraphNode,
  type RunnerVersionRequirement
} from '../../packages/core/src/broker/runner-version-contract.ts';

// Deterministic fixtures (ATM-GOV-0266).
const SEAL_A = 'a'.repeat(40);
const SEAL_B = 'b'.repeat(40);
const SEAL_C = 'c'.repeat(40);
const SEAL_UNKNOWN = 'd'.repeat(40);
const SURFACES = ['packages/cli/dist', 'release/atm-onefile/atm.mjs', 'release/atm-root-drop'];
const COMPAT = 'runner-abi-1';
const VALIDATORS = ['typecheck', 'git-record-commit'];
const SCHEMAS = ['atm.runnerVersionSelectionReceipt.v1'];

const nodesA: readonly RunnerInputGraphNode[] = [
  { segment: 'packages', inputPaths: ['packages/core/src/x.ts'], inputDigest: 'sha256:pkgin', outputEntries: ['packages/core'], outputDigest: 'sha256:pkgout' },
  { segment: 'scripts', inputPaths: ['scripts/build.ts'], inputDigest: 'sha256:scin', outputEntries: ['release/atm-onefile/atm.mjs'], outputDigest: 'sha256:scout' }
];
const nodesB: readonly RunnerInputGraphNode[] = [
  { segment: 'packages', inputPaths: ['packages/core/src/x.ts'], inputDigest: 'sha256:pkginB', outputEntries: ['packages/core'], outputDigest: 'sha256:pkgoutB' }
];
const aggregate = computeAggregateInputTreeHash(nodesA);
const aggregateB = computeAggregateInputTreeHash(nodesB);

function version(over: Partial<PublishedRunnerVersion> & { sealedSourceSha: string }): PublishedRunnerVersion {
  return {
    aggregateInputTreeHash: aggregate,
    publishedSurfaces: SURFACES,
    publishedAt: '2026-07-27T00:00:00.000Z',
    lifecycleState: 'published',
    compatibilityKey: COMPAT,
    capabilityProof: { validators: VALIDATORS, schemas: SCHEMAS },
    ...over
  };
}

function requirement(over: Partial<RunnerVersionRequirement> & { sealedSourceSha: string }): RunnerVersionRequirement {
  return { requiredSurfaces: SURFACES, ...over };
}

// SEAL_A: latest trusted, aggregate A. SEAL_B: older trusted, aggregate B.
const registry = createRunnerVersionRegistry([
  version({ sealedSourceSha: SEAL_A, aggregateInputTreeHash: aggregate, publishedAt: '2026-07-27T09:00:00.000Z' }),
  version({ sealedSourceSha: SEAL_B, aggregateInputTreeHash: aggregateB, publishedAt: '2026-07-20T00:00:00.000Z' })
]);

// 1. Exact sealed-source match covering surfaces (trusted).
{
  const selection = selectRunnerVersion(registry, requirement({ sealedSourceSha: SEAL_A }));
  assert.equal(selection.outcome, 'exact-seal-match');
  assert.equal(selection.errorCode, null);
  assert.deepEqual([...selection.selectedSurfaces].sort(), [...SURFACES].sort());
}

// 2. Aggregate-hash fallback: different sha, same input generation, trusted +
//    compatible + capability-proven.
{
  const selection = selectRunnerVersion(
    registry,
    requirement({
      sealedSourceSha: SEAL_UNKNOWN,
      aggregateInputTreeHash: aggregate,
      compatibilityKey: COMPAT,
      requiredValidatorCapabilities: VALIDATORS,
      requiredSchemaCapabilities: SCHEMAS
    })
  );
  assert.equal(selection.outcome, 'aggregate-hash-match');
  assert.equal(selection.errorCode, null);
  assert.equal(selection.sealedSourceSha, SEAL_A);
}

// 3. Non-latest trusted compatible version selection: requesting the older
//    SEAL_B exactly resolves to it even though SEAL_A is newer.
{
  const selection = selectRunnerVersion(registry, requirement({ sealedSourceSha: SEAL_B }));
  assert.equal(selection.outcome, 'exact-seal-match');
  assert.equal(selection.sealedSourceSha, SEAL_B);
}

// 4. Rejected untrusted aggregate-hash candidate (provisional lifecycle).
{
  const provisionalRegistry = createRunnerVersionRegistry([
    version({ sealedSourceSha: SEAL_A, aggregateInputTreeHash: aggregate, lifecycleState: 'provisional' })
  ]);
  const selection = selectRunnerVersion(
    provisionalRegistry,
    requirement({ sealedSourceSha: SEAL_UNKNOWN, aggregateInputTreeHash: aggregate })
  );
  assert.equal(selection.outcome, 'seal-revalidation-required');
  assert.equal(selection.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
  assert.match(selection.reason, /not trusted/i);
}

// 5. Rejected incompatible aggregate-hash candidate (compatibility identity drift).
{
  const selection = selectRunnerVersion(
    registry,
    requirement({ sealedSourceSha: SEAL_UNKNOWN, aggregateInputTreeHash: aggregate, compatibilityKey: 'runner-abi-2' })
  );
  assert.equal(selection.outcome, 'seal-revalidation-required');
  assert.match(selection.reason, /compatibility/i);
}

// 6. Rejected aggregate-hash candidate missing a required validator capability.
{
  const selection = selectRunnerVersion(
    registry,
    requirement({
      sealedSourceSha: SEAL_UNKNOWN,
      aggregateInputTreeHash: aggregate,
      requiredValidatorCapabilities: ['a-validator-not-proven']
    })
  );
  assert.equal(selection.outcome, 'seal-revalidation-required');
  assert.match(selection.reason, /capability/i);
}

// 7. Exact seal to an untrusted (revoked) version is not selectable.
{
  const revokedRegistry = createRunnerVersionRegistry([
    version({ sealedSourceSha: SEAL_C, aggregateInputTreeHash: aggregate, lifecycleState: 'revoked' })
  ]);
  const selection = selectRunnerVersion(revokedRegistry, requirement({ sealedSourceSha: SEAL_C }));
  assert.notEqual(selection.outcome, 'exact-seal-match');
  assert.equal(selection.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
}

// 8. Unknown seal + no aggregate → fail closed with seal-revalidation.
{
  const selection = selectRunnerVersion(registry, requirement({ sealedSourceSha: SEAL_UNKNOWN }));
  assert.equal(selection.outcome, 'seal-revalidation-required');
  assert.equal(selection.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
  assert.equal(selection.selectedSurfaces.length, 0);
}

// 9. Missing required surface → fail closed even on exact seal.
{
  const selection = selectRunnerVersion(
    registry,
    requirement({ sealedSourceSha: SEAL_A, requiredSurfaces: [...SURFACES, 'release/never-published'] })
  );
  assert.equal(selection.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
}

// 10. Empty registry → no-candidate.
{
  const emptyRegistry = createRunnerVersionRegistry([]);
  const selection = selectRunnerVersion(emptyRegistry, requirement({ sealedSourceSha: SEAL_A }));
  assert.equal(selection.outcome, 'no-candidate');
  assert.equal(selection.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
}

console.log('runner-version-selection.test.ts: 10 cases passed');
