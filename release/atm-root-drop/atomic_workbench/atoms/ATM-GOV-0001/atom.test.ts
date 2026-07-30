import assert from 'node:assert/strict';

// @ts-expect-error atom.source.mjs is the runtime JS atom entrypoint under test.
import { atomMetadata, runAtom, selfCheck } from './atom.source.mjs';

export const atomSpecPath = 'atom.spec.json';

const sealedIdentity = {
  repoIdentity: 'atom://planning-repo',
  taskCardPath: 'tasks/example.task.md',
  planningCommitSha: null,
  contentDigest: 'sha256:atom-test-digest',
  amendmentEpoch: 0
};

const committedUnchanged = { ...sealedIdentity, planningCommitSha: 'f'.repeat(40) };

assert.equal(atomMetadata.atomId, 'ATM-GOV-0001');
assert.equal(
  atomMetadata.atomizedFrom,
  'packages/cli/src/commands/tasks/planning-source-seal-policy.ts#classifyPlanningSourceSeal'
);

const unchanged = runAtom({ sealed: sealedIdentity, current: { ...sealedIdentity } });
assert.equal(unchanged.ok, true);
assert.equal(unchanged.classification.status, 'match');

// null -> sha with identical content is a benign storage-identity upgrade.
const benign = runAtom({ sealed: sealedIdentity, current: committedUnchanged });
assert.equal(benign.classification.status, 'benign-seal-upgrade');
assert.equal(benign.classification.ok, true);
assert.deepEqual(benign.classification.driftKinds, []);
assert.deepEqual(benign.classification.benignUpgradeKinds, ['commit']);

// The same sha delta with moved content must never ride in as benign.
const drifted = runAtom({
  sealed: sealedIdentity,
  current: { ...committedUnchanged, contentDigest: 'sha256:atom-test-digest-moved' }
});
assert.equal(drifted.classification.status, 'drift');
assert.equal(drifted.classification.ok, false);
assert.deepEqual(drifted.classification.benignUpgradeKinds, []);
assert.ok(drifted.classification.driftKinds.includes('content'));

// An advanced amendment epoch remains the governed route for a real card edit.
const amended = runAtom({
  sealed: sealedIdentity,
  current: { ...committedUnchanged, contentDigest: 'sha256:atom-test-digest-moved', amendmentEpoch: 1 }
});
assert.equal(amended.classification.status, 'governed-amendment');
assert.equal(amended.classification.ok, true);

// A sealed sha that moves to a different sha is not benign, even unchanged.
const resealed = runAtom({
  sealed: { ...sealedIdentity, planningCommitSha: 'a'.repeat(40) },
  current: committedUnchanged
});
assert.equal(resealed.classification.status, 'drift');

assert.equal(selfCheck(), true);

console.log('[ATM-GOV-0001] ok');
