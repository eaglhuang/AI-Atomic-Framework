import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../../../plugin-governance-local/src/index.ts';
import { readFrameworkTempLockProjection } from '../framework-temp-lock-projection.ts';
import { resolveFrameworkTempPublicationCapability } from '../framework-temp-publication-capability.ts';

/**
 * ATM-GOV-0395 — durable lane ownership across producer, reader, and consumer.
 *
 * Before this repair the lane was carried only inside the work item id. The
 * lock store never wrote a `laneSessionId`, the projection therefore always
 * read null, and the consumer compared that null against the caller's lane and
 * excluded the lock. An actor holding a live claim could not use it: with a
 * lane exported the lock was invisible, and without one it was rejected as
 * "not bound to the current lane".
 *
 * The contract pinned here is that absence of a recorded lane means *unknown*,
 * never *different* — and that an unknown lane is reconciled explicitly rather
 * than guessed.
 */

delete process.env.ATM_ACTOR_ID;
delete process.env.ATM_LANE_SESSION_ID;

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-provenance-'));
  mkdirSync(path.join(root, '.atm', 'runtime', 'locks'), { recursive: true });
  mkdirSync(path.join(root, '.atm', 'history', 'tasks'), { recursive: true });
  return root;
}

function workItem(workItemId: string) {
  return { workItemId, title: workItemId, status: 'running' as const };
}

function writeLegacyLock(root: string, workItemId: string, actorId: string, files: readonly string[]): void {
  const timestamp = new Date().toISOString();
  writeFileSync(
    path.join(root, '.atm', 'runtime', 'locks', `${workItemId}.lock.json`),
    JSON.stringify({
      schemaId: 'atm.governanceScopeLock',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'Scope lock baseline record.' },
      workItemId,
      lockedBy: actorId,
      actorId,
      lockedAt: timestamp,
      leaseId: 'lease-legacy',
      heartbeatAt: timestamp,
      ttlSeconds: 1800,
      files: [...files]
      // Deliberately no laneSessionId: this is the shape every lock had before
      // this card, and the shape that must stay reconcilable afterwards.
    }, null, 2),
    'utf8'
  );
}

// caseId: framework_claim_resolves_regardless_of_lane_binding_0395
// A newly written lock records its lane, and its owner resolves it while
// running in that lane.
{
  const root = tempRoot();
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: root });
  await adapter.stores.lockStore.acquireLock(workItem('ATM-FRAMEWORK-TEMP-actor-a'), ['a.ts'], 'actor-a', 'lane-one');

  const written = JSON.parse(
    readFileSync(path.join(root, '.atm', 'runtime', 'locks', 'ATM-FRAMEWORK-TEMP-actor-a.lock.json'), 'utf8')
  ) as Record<string, unknown>;
  assert.equal(written.laneSessionId, 'lane-one', 'the producer must record the lane it was given');

  const [projected] = readFrameworkTempLockProjection(root);
  assert.equal(projected.laneSessionId, 'lane-one');
  assert.equal(projected.laneProvenance, 'recorded', 'an explicit lane must be reported as recorded');

  const capability = resolveFrameworkTempPublicationCapability({
    cwd: root, taskId: null, actorId: 'actor-a', laneSessionId: 'lane-one'
  });
  assert(capability, 'an owner running in the recorded lane must resolve its own claim');
  assert(capability.allowedFiles.includes('a.ts'));
}

// A recorded lane that belongs to a different lane must not resolve. This is
// the property the null-comparison appeared to provide but never did.
{
  const root = tempRoot();
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: root });
  await adapter.stores.lockStore.acquireLock(workItem('ATM-FRAMEWORK-TEMP-actor-a'), ['a.ts'], 'actor-a', 'lane-one');

  assert.equal(
    resolveFrameworkTempPublicationCapability({
      cwd: root, taskId: null, actorId: 'actor-a', laneSessionId: 'lane-two'
    }),
    null,
    'a lock recorded against another lane must stay unusable'
  );
}

// A legacy lock has an unknown lane, not a different one, so its owner can
// still reconcile it — which is exactly the case that was dead-locked.
{
  const root = tempRoot();
  writeLegacyLock(root, 'ATM-FRAMEWORK-TEMP-actor-a', 'actor-a', ['legacy.ts']);

  const [projected] = readFrameworkTempLockProjection(root);
  assert.equal(projected.laneSessionId, null);
  assert.equal(projected.laneProvenance, 'unrecorded-legacy', 'a missing lane must be reported as legacy provenance');

  const withLane = resolveFrameworkTempPublicationCapability({
    cwd: root, taskId: null, actorId: 'actor-a', laneSessionId: 'lane-one'
  });
  assert(withLane, 'a legacy lock must remain reconcilable by its owner while running in a lane');
  assert(withLane.allowedFiles.includes('legacy.ts'));

  const withoutLane = resolveFrameworkTempPublicationCapability({
    cwd: root, taskId: null, actorId: 'actor-a', laneSessionId: null
  });
  assert(withoutLane, 'the same legacy lock must also resolve with no lane exported');
}

// Migration: once the owner reacquires under a lane, the lock stops being
// legacy and gains a lane the reader can compare in both directions.
{
  const root = tempRoot();
  writeLegacyLock(root, 'ATM-FRAMEWORK-TEMP-actor-a', 'actor-a', ['legacy.ts']);
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: root });
  await adapter.stores.lockStore.acquireLock(workItem('ATM-FRAMEWORK-TEMP-actor-a'), ['legacy.ts'], 'actor-a', 'lane-one');

  const [projected] = readFrameworkTempLockProjection(root);
  assert.equal(projected.laneProvenance, 'recorded', 'reacquiring under a lane must migrate the lock out of legacy provenance');
  assert.equal(
    resolveFrameworkTempPublicationCapability({
      cwd: root, taskId: null, actorId: 'actor-a', laneSessionId: 'lane-two'
    }),
    null,
    'after migration the lock must be excluded from other lanes'
  );
}

// Ambiguity fails closed: a legacy lock must not compete with a lock this
// actor already recorded for the running lane.
{
  const root = tempRoot();
  writeLegacyLock(root, 'ATM-FRAMEWORK-TEMP-actor-a-legacy', 'actor-a', ['legacy.ts']);
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: root });
  await adapter.stores.lockStore.acquireLock(workItem('ATM-FRAMEWORK-TEMP-actor-a'), ['current.ts'], 'actor-a', 'lane-one');

  const capability = resolveFrameworkTempPublicationCapability({
    cwd: root, taskId: null, actorId: 'actor-a', laneSessionId: 'lane-one'
  });
  assert(capability, 'the lock recorded for the running lane must win over a legacy leftover');
  assert(capability.allowedFiles.includes('current.ts'));

  // Two legacy locks for one actor are genuinely ambiguous and must resolve to
  // nothing rather than to a guess.
  const ambiguousRoot = tempRoot();
  writeLegacyLock(ambiguousRoot, 'ATM-FRAMEWORK-TEMP-actor-a-one', 'actor-a', ['one.ts']);
  writeLegacyLock(ambiguousRoot, 'ATM-FRAMEWORK-TEMP-actor-a-two', 'actor-a', ['two.ts']);
  assert.equal(
    resolveFrameworkTempPublicationCapability({
      cwd: ambiguousRoot, taskId: null, actorId: 'actor-a', laneSessionId: 'lane-one'
    }),
    null,
    'ambiguous legacy ownership must fail closed instead of picking one'
  );
}

// caseId: closed_task_residue_has_one_reconciliation_entry_0395
// The residue case in its own terms: a lane-bound claim over records generated
// by a close must resolve, so the operator has one governed route to commit
// them after the task's own claim is gone.
{
  const root = tempRoot();
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: root });
  const residueFiles = ['.atm/history/evidence/FIXTURE-TASK.bundle-manifest.json'];
  await adapter.stores.lockStore.acquireLock(
    workItem('ATM-FRAMEWORK-TEMP-actor-a'), residueFiles, 'actor-a', 'lane-one'
  );

  const capability = resolveFrameworkTempPublicationCapability({
    cwd: root, taskId: null, actorId: 'actor-a', laneSessionId: 'lane-one'
  });
  assert(capability, 'residue generated by a close must be claimable through a lane-bound framework claim');
  assert(residueFiles.every((file) => capability.allowedFiles.includes(file)));
}

console.log('[lane-ownership-provenance.spec] ok');
