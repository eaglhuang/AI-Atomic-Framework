import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  frameworkTempPublicationCapabilityCovers,
  resolveFrameworkCommitAuthorityContext,
  resolveFrameworkTempPublicationCapability,
} from '../../framework-development/framework-temp-publication-capability.ts';
import { assertFrameworkCommitClaimAuthority } from '../implementation/framework-commit-claim-guard.ts';
import { evaluateTaskWorkAdmissionGate } from '../work-admission-check.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-temp-publication-'));
const taskId = 'ATM-FRAMEWORK-TEMP-publication';
const nowMs = Date.now();
const now = new Date(nowMs).toISOString();
mkdirSync(path.join(cwd, '.atm', 'runtime', 'locks'), { recursive: true });
mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
mkdirSync(path.join(cwd, '.atm', 'history', 'evidence'), { recursive: true });
mkdirSync(path.join(cwd, 'release', 'atm-root-drop'), { recursive: true });
writeFileSync(path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`), `${JSON.stringify({
  workItemId: taskId,
  actorId: 'publication-steward',
  heartbeatAt: new Date(nowMs - 1_000).toISOString(),
  ttlSeconds: 3600,
  laneSessionId: 'lane-publication',
  linkedTaskId: 'ATM-GOV-0342',
  files: ['release/atm-onefile/atm.mjs', 'release/atm-root-drop'],
}, null, 2)}\n`, 'utf8');
writeFileSync(path.join(cwd, '.atm', 'runtime', 'locks', 'ATM-FRAMEWORK-TEMP-other-live-claim.lock.json'), `${JSON.stringify({
  workItemId: 'ATM-FRAMEWORK-TEMP-other-live-claim',
  actorId: 'publication-steward',
  heartbeatAt: new Date(nowMs - 1_000).toISOString(),
  ttlSeconds: 3600,
  laneSessionId: 'lane-other',
  linkedTaskId: 'ATM-GOV-elsewhere',
  files: ['release/atm-onefile/atm.mjs'],
}, null, 2)}\n`, 'utf8');
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'ATM-GOV-0344.json'), `${JSON.stringify({ status: 'done' })}\n`, 'utf8');
writeFileSync(path.join(cwd, '.atm', 'history', 'evidence', 'ATM-GOV-0344.runner-sync-receipt.json'), `${JSON.stringify({
  schemaId: 'atm.runnerSyncReceipt.v1',
  taskId: 'ATM-GOV-0344',
  actorId: 'publication-steward',
  stewardWorkId: 'runner-sync-fixture',
  sealedSourceSha: 'a'.repeat(40),
})}\n`, 'utf8');
writeFileSync(path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.runner-sync-receipt.json`), `${JSON.stringify({
  schemaId: 'atm.runnerSyncReceipt.v1',
  taskId,
  actorId: 'publication-steward',
  outputInventory: { entries: [
    { path: 'packages/cli/dist/commands/generated.js', disposition: 'owned-current' },
    { path: 'packages/cli/dist/commands/foreign.js', disposition: 'foreign-retained' },
  ] },
})}\n`, 'utf8');
writeFileSync(path.join(cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json'), `${JSON.stringify({
  groups: [{
    queuePosition: 1,
    stewardWorkId: 'runner-sync-fixture',
    sealedSourceSha: 'a'.repeat(40),
    requests: [{ taskId: 'ATM-GOV-0344', actorId: 'publication-steward', sealedSourceSha: 'a'.repeat(40) }],
  }],
})}\n`, 'utf8');

const capability = resolveFrameworkTempPublicationCapability({
  cwd,
  taskId,
  actorId: 'publication-steward',
  now: Date.parse(now),
});
assert.equal(capability?.laneSessionId, 'lane-publication');
assert.equal(frameworkTempPublicationCapabilityCovers(capability, [
  'release/atm-onefile/atm.mjs',
  'release/atm-root-drop/atm.mjs',
]), true);
assert.equal(frameworkTempPublicationCapabilityCovers(capability, ['packages/core/src/outside.ts']), false);
assert.equal(frameworkTempPublicationCapabilityCovers(capability, [
  '.atm/history/evidence/ATM-GOV-0342.runner-sync-receipt.json',
]), true);
assert.equal(frameworkTempPublicationCapabilityCovers(capability, [
  `.atm/history/evidence/${taskId}.runner-sync-receipt.json`,
]), true, 'a temporary build receipt must always be publishable by its own lock');
assert.equal(frameworkTempPublicationCapabilityCovers(capability, [
  'packages/cli/dist/commands/generated.js',
]), true, 'the receipt-owned generated output must be publishable even when no release manifest lists it');
assert.equal(frameworkTempPublicationCapabilityCovers(capability, [
  'packages/cli/dist/commands/foreign.js',
]), false, 'a receipt must not grant publication authority over foreign inventory entries');
assert.equal(frameworkTempPublicationCapabilityCovers(capability, [
  '.atm/history/evidence/ATM-GOV-0344.runner-sync-receipt.json',
]), true, 'queue/receipt-bound terminal continuation must be publishable without reopening its task');

const unboundCommit = resolveFrameworkCommitAuthorityContext({
  cwd,
  taskId: null,
  actorId: 'publication-steward',
  taskExists: false,
});
assert.equal(unboundCommit.frameworkClaimRequired, true);
assert.equal(unboundCommit.usesFrameworkClaimCommit, false, 'taskless commits must not fall back to every actor-owned staged file');
assert.throws(
  () => assertFrameworkCommitClaimAuthority({ actorId: 'publication-steward', laneSessionId: null, authority: unboundCommit }),
  (error: unknown) => {
    const candidate = error as { code?: string; details?: { frameworkClaimResolution?: { liveOwnedClaimCount?: number; eligibleClaimCount?: number } } };
    return candidate.code === 'ATM_GIT_COMMIT_FRAMEWORK_CLAIM_REQUIRED'
      && candidate.details?.frameworkClaimResolution?.liveOwnedClaimCount === 2
      && candidate.details?.frameworkClaimResolution?.eligibleClaimCount === 0;
  },
);

const priorLaneSessionId = process.env.ATM_LANE_SESSION_ID;
process.env.ATM_LANE_SESSION_ID = 'lane-publication';
try {
  const laneBoundCommit = resolveFrameworkCommitAuthorityContext({
    cwd,
    taskId: null,
    actorId: 'publication-steward',
    taskExists: false,
  });
  assert.equal(laneBoundCommit.usesFrameworkClaimCommit, true);
  assert.deepEqual(laneBoundCommit.frameworkClaimFiles, capability?.allowedFiles, 'taskless commit scope is exactly the lane-bound capability allowlist');
  assert.doesNotThrow(() => assertFrameworkCommitClaimAuthority({ actorId: 'publication-steward', laneSessionId: 'lane-publication', authority: laneBoundCommit }));
} finally {
  if (priorLaneSessionId === undefined) delete process.env.ATM_LANE_SESSION_ID;
  else process.env.ATM_LANE_SESSION_ID = priorLaneSessionId;
}

assert.equal(resolveFrameworkTempPublicationCapability({
  cwd,
  taskId: null,
  actorId: 'publication-steward',
  now: Date.parse(now),
}), null, 'taskless publication must not guess between same-actor claims');
const laneBound = resolveFrameworkTempPublicationCapability({
  cwd,
  taskId: null,
  actorId: 'publication-steward',
  laneSessionId: 'lane-publication',
  now: Date.parse(now),
});
assert.equal(laneBound?.taskId, taskId, 'taskless publication must bind to the current lane claim');
assert.equal(frameworkTempPublicationCapabilityCovers(laneBound, [
  '.atm/history/evidence/ATM-GOV-0342.runner-sync-receipt.json',
]), true);

const noLaneTaskId = 'ATM-FRAMEWORK-TEMP-publication-steward-lane-legacy-producer';
writeFileSync(path.join(cwd, '.atm', 'runtime', 'locks', `${noLaneTaskId}.lock.json`), `${JSON.stringify({
  workItemId: noLaneTaskId,
  actorId: 'publication-steward',
  heartbeatAt: new Date(nowMs - 1_000).toISOString(),
  ttlSeconds: '3600',
  files: ['release/atm-onefile/atm.mjs'],
}, null, 2)}\n`, 'utf8');
const noLaneBound = resolveFrameworkTempPublicationCapability({
  cwd,
  taskId: null,
  actorId: 'publication-steward',
  now: Date.parse(now),
});
assert.equal(
  noLaneBound?.taskId,
  noLaneTaskId,
  'a taskless command without a lane may recover exactly one live unrecorded lock when a legacy producer serialized a lane-qualified id without lane metadata',
);
assert.doesNotThrow(() => assertFrameworkCommitClaimAuthority({
  actorId: 'publication-steward',
  laneSessionId: null,
  authority: resolveFrameworkCommitAuthorityContext({
    cwd,
    taskId: null,
    actorId: 'publication-steward',
    taskExists: false,
  }),
}));

const admitted = evaluateTaskWorkAdmissionGate({
  cwd,
  taskId,
  operation: 'commit',
  files: ['release/atm-onefile/atm.mjs'],
  producingAtmCommand: 'node atm.mjs git commit',
  now,
});
assert.equal(admitted.decision.ok, true);
assert.equal(admitted.receipt?.actorId, 'publication-steward');

const expired = resolveFrameworkTempPublicationCapability({
  cwd,
  taskId,
  actorId: 'publication-steward',
  now: nowMs + 3_700_000,
});
assert.equal(expired, null);

const missingOwnerDiagnostics = resolveFrameworkCommitAuthorityContext({
  cwd,
  taskId: null,
  actorId: 'missing-owner',
  taskExists: false,
});
assert.equal(missingOwnerDiagnostics.frameworkClaimResolution?.lockScan.lockRootExists, true);
assert.equal(missingOwnerDiagnostics.frameworkClaimResolution?.lockScan.discoveredLockFileCount >= 1, true);
assert.equal(missingOwnerDiagnostics.frameworkClaimResolution?.observedOwnedLockCount, 0);

const staleTaskId = 'ATM-FRAMEWORK-TEMP-stale-owner';
writeFileSync(path.join(cwd, '.atm', 'runtime', 'locks', `${staleTaskId}.lock.json`), `${JSON.stringify({
  workItemId: staleTaskId,
  actorId: 'stale-owner',
  heartbeatAt: new Date(nowMs - 7_200_000).toISOString(),
  ttlSeconds: 60,
  files: ['docs/stale.md'],
}, null, 2)}\n`, 'utf8');
const staleOwnerDiagnostics = resolveFrameworkCommitAuthorityContext({
  cwd,
  taskId: null,
  actorId: 'stale-owner',
  taskExists: false,
});
assert.equal(staleOwnerDiagnostics.frameworkClaimResolution?.observedOwnedLockCount, 1);
assert.equal(staleOwnerDiagnostics.frameworkClaimResolution?.staleOwnedClaimCount, 1);
assert.deepEqual(staleOwnerDiagnostics.frameworkClaimResolution?.staleOwnedTaskIds, [staleTaskId]);
console.log('framework-temp-publication-capability: ok');
