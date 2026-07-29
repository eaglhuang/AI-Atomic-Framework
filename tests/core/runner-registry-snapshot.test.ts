import assert from 'node:assert/strict';
import {
  buildRunnerRegistrySnapshot,
  createRegistryFromSnapshot,
  readRunnerRegistrySnapshotValue
} from '../../packages/core/src/broker/runner-registry-snapshot.ts';
import { selectRunnerVersion, type PublishedRunnerVersion } from '../../packages/core/src/broker/runner-version-registry.ts';

const versionA: PublishedRunnerVersion = {
  sealedSourceSha: 'a'.repeat(40),
  aggregateInputTreeHash: 'sha256:' + '1'.repeat(64),
  publishedSurfaces: ['release/atm-onefile/atm.mjs', 'packages/cli/dist'],
  publishedAt: '2026-07-29T00:00:00.000Z',
  lifecycleState: 'published',
  compatibilityKey: 'runner-abi-1',
  capabilityProof: { validators: ['typecheck'], schemas: ['atm.runnerVersionSelectionReceipt.v1'] }
};

const versionB: PublishedRunnerVersion = {
  ...versionA,
  sealedSourceSha: 'b'.repeat(40),
  aggregateInputTreeHash: 'sha256:' + '2'.repeat(64),
  publishedSurfaces: [...versionA.publishedSurfaces].reverse(),
  publishedAt: '2026-07-28T00:00:00.000Z'
};

const snapshot = buildRunnerRegistrySnapshot({
  versions: [versionB, versionA],
  generatedAt: '2026-07-29T01:00:00.000Z',
  policyVersion: 'runner-selection-policy@0.2.0'
});

const roundTrip = readRunnerRegistrySnapshotValue(JSON.parse(JSON.stringify(snapshot)));
assert.equal(roundTrip.snapshotDigest, snapshot.snapshotDigest);
assert.deepEqual(roundTrip.versions.map((version) => version.sealedSourceSha), [versionA.sealedSourceSha, versionB.sealedSourceSha]);

const registry = createRegistryFromSnapshot(snapshot);
const selection = selectRunnerVersion(registry, {
  sealedSourceSha: versionA.sealedSourceSha,
  requiredSurfaces: ['packages/cli/dist']
});
assert.equal(selection.outcome, 'exact-seal-match');
assert.equal(selection.sealedSourceSha, versionA.sealedSourceSha);

assert.throws(
  () => readRunnerRegistrySnapshotValue({ ...snapshot, snapshotDigest: 'sha256:' + '0'.repeat(64) }),
  /digest mismatch/i
);

console.log('runner-registry-snapshot.test.ts: 4 cases passed');
