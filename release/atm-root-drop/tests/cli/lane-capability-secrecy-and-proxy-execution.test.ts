import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authorizeLaneCapability,
  evaluateLaneCapability
} from '../../packages/cli/src/commands/lane-session/capability-authority.ts';
import {
  issueProxyReceipt,
  listProxyReceipts
} from '../../packages/cli/src/commands/lane-session/proxy-receipt.ts';
import {
  capabilityFingerprint,
  redactCapabilityKeys
} from '../../packages/cli/src/commands/lane-session/redaction.ts';

/**
 * Lane capability secrecy + proxy execution.
 *
 * Covers: replayable-key redaction for non-owner reports, non-replayable
 * proxy/takeover receipts, approved-proxy execution writing an audit artifact,
 * single-use consumption, and adopted-owner-lane pass-through. Generic fixture
 * — no task/actor/date/path special cases (INV-ATM-009).
 */

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-secrecy-'));

function writeJson(relativePath: string, value: unknown): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeLaneSession(laneId: string, actorId: string, extra: Record<string, unknown> = {}): void {
  writeJson(`.atm/runtime/lane-sessions/${laneId}.json`, {
    schemaId: 'atm.laneSession.v1',
    specVersion: '0.1.0',
    laneId,
    actorId,
    taskId: null,
    status: 'active',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
    ttlMs: 1800000,
    identity: { actorId, editor: null, gitName: null, gitEmail: null, provider: null, activeSessionId: null },
    adoptionSource: { kind: 'mint', sourceLaneId: null, sourceActorId: null, reason: null },
    handoffTokenHash: null,
    lastCommand: null,
    lastHeartbeatAt: '2026-07-24T00:00:00.000Z',
    ...extra
  });
}

function writeLaneBoundClaim(taskId: string, ownerActorId: string, ownerLaneId: string): void {
  writeJson(`.atm/history/tasks/${taskId}.json`, {
    id: taskId,
    status: 'in_progress',
    claim: {
      actorId: ownerActorId,
      leaseId: 'lease-secret-key-999',
      claimedAt: '2026-07-24T00:00:00.000Z',
      heartbeatAt: '2026-07-24T00:00:00.000Z',
      ttlSeconds: 1800,
      files: ['packages/cli/src/commands/example.ts'],
      state: 'active',
      laneSession: {
        laneSessionId: ownerLaneId,
        status: 'active',
        source: 'option',
        exportHint: `export ATM_LANE_SESSION_ID=${JSON.stringify(ownerLaneId)}`
      }
    }
  });
}

try {
  const ownerLane = 'lane-owner-secret-cccccccccc';
  const executorLane = 'lane-executor-dddddddddd';
  const ownerActor = 'owner-worker';
  const executorActor = 'proxy-captain';
  const taskId = 'WORK-ITEM-0002';

  writeLaneSession(ownerLane, ownerActor);
  writeLaneSession(executorLane, executorActor);
  writeLaneBoundClaim(taskId, ownerActor, ownerLane);

  // --- Redaction: reusable capability keys never survive in a non-owner report ---
  const rawReport = {
    taskId,
    actorId: ownerActor,
    state: 'in_progress',
    queueVerdict: 'noConflict',
    laneSessionId: ownerLane,
    leaseId: 'lease-secret-key-999',
    ticketKey: 'ticket-raw-replayable-777',
    handoffToken: 'handoff-raw-replayable-555',
    nested: { claimLeaseId: 'lease-secret-key-999' }
  };
  const redacted = redactCapabilityKeys(rawReport);
  const redactedText = JSON.stringify(redacted);
  for (const secret of [ownerLane, 'lease-secret-key-999', 'ticket-raw-replayable-777', 'handoff-raw-replayable-555']) {
    assert.ok(!redactedText.includes(secret), `redacted report must not contain replayable key ${secret}`);
  }
  // But it may still show attribution + fingerprints + verdict.
  assert.equal(redacted.taskId, taskId);
  assert.equal(redacted.actorId, ownerActor);
  assert.equal(redacted.queueVerdict, 'noConflict');
  assert.equal(redacted.laneSessionId, capabilityFingerprint(ownerLane, 'lane'));
  assert.equal(redacted.ticketKey, capabilityFingerprint('ticket-raw-replayable-777', 'ticket'));
  assert.equal(redacted.nested.claimLeaseId, capabilityFingerprint('lease-secret-key-999', 'lease'));

  // Owner exemption: an owner may keep its own live lane id.
  const ownerView = redactCapabilityKeys(rawReport, { exemptLaneSessionIds: [ownerLane] });
  assert.equal(ownerView.laneSessionId, ownerLane);
  assert.equal(ownerView.leaseId, capabilityFingerprint('lease-secret-key-999', 'lease')); // lease still redacted

  // --- A non-owner cannot learn a replayable ticket key through normal status ---
  const proxyStatusReceiptsBefore = listProxyReceipts(repo);
  assert.equal(proxyStatusReceiptsBefore.length, 0);

  // --- Executor lacking a receipt is blocked ---
  const blocked = evaluateLaneCapability({
    cwd: repo,
    taskId,
    actorId: ownerActor,
    commandClass: 'taskflow-close-write',
    executingLaneSessionId: executorLane
  });
  assert.equal(blocked.decisionClass, 'borrowed-actor-blocked');

  // --- Human/captain approval mints a non-replayable receipt ---
  const issued = issueProxyReceipt({
    cwd: repo,
    grantKind: 'proxy',
    approver: 'human-operator',
    executorLaneId: executorLane,
    ownerLaneId: ownerLane,
    taskId,
    commandClasses: ['taskflow-close-write'],
    reason: 'owner unavailable; captain completes close',
    ttlMs: 1800000
  });
  // The stored receipt keeps only a nonce hash, never the replayable nonce.
  const storedText = JSON.stringify(listProxyReceipts(repo));
  assert.ok(!storedText.includes(issued.nonce), 'stored receipt must not contain replayable nonce');
  assert.ok(storedText.includes(issued.receipt.nonceHash));

  // --- Approved proxy execution passes and writes an audit artifact ---
  const approved = authorizeLaneCapability({
    cwd: repo,
    taskId,
    actorId: executorActor,
    commandClass: 'taskflow-close-write',
    executingLaneSessionId: executorLane
  });
  assert.equal(approved.decision.allowed, true);
  assert.equal(approved.decision.decisionClass, 'approved-proxy');
  assert.ok(approved.auditPath, 'approved proxy must write an audit artifact');
  assert.ok(existsSync(path.join(repo, approved.auditPath!)), 'audit artifact must exist on disk');

  // --- Receipt is single-use: a second attempt is blocked ---
  const replay = evaluateLaneCapability({
    cwd: repo,
    taskId,
    actorId: executorActor,
    commandClass: 'taskflow-close-write',
    executingLaneSessionId: executorLane
  });
  assert.equal(replay.decisionClass, 'borrowed-actor-blocked', 'consumed receipt must not be replayable');

  // --- A receipt only delegates the named surface ---
  issueProxyReceipt({
    cwd: repo,
    approver: 'human-operator',
    executorLaneId: executorLane,
    ownerLaneId: ownerLane,
    taskId,
    commandClasses: ['governed-commit'],
    reason: 'commit only',
    ttlMs: 1800000
  });
  const pushStillBlocked = evaluateLaneCapability({
    cwd: repo,
    taskId,
    actorId: executorActor,
    commandClass: 'push',
    executingLaneSessionId: executorLane
  });
  assert.equal(pushStillBlocked.decisionClass, 'borrowed-actor-blocked', 'push is not delegated by a commit-only receipt');
  const commitAllowed = evaluateLaneCapability({
    cwd: repo,
    taskId,
    actorId: executorActor,
    commandClass: 'governed-commit',
    executingLaneSessionId: executorLane
  });
  assert.equal(commitAllowed.decisionClass, 'approved-proxy');

  // --- Adopted owner lane passes without a receipt ---
  const adoptedLane = 'lane-adopted-eeeeeeeeee';
  writeLaneSession(adoptedLane, executorActor, {
    adoptionSource: { kind: 'adoption', sourceLaneId: ownerLane, sourceActorId: ownerActor, reason: 'ttl-expired adopt' }
  });
  const adopted = evaluateLaneCapability({
    cwd: repo,
    taskId,
    actorId: executorActor,
    commandClass: 'push',
    executingLaneSessionId: adoptedLane
  });
  assert.equal(adopted.allowed, true);
  assert.equal(adopted.decisionClass, 'adopted-owner-lane');

  // --- Expired receipt does not authorize ---
  const expiredExecutorLane = 'lane-expired-exec-ffffffffff';
  writeLaneSession(expiredExecutorLane, 'other-captain');
  issueProxyReceipt({
    cwd: repo,
    approver: 'human-operator',
    executorLaneId: expiredExecutorLane,
    ownerLaneId: ownerLane,
    taskId,
    commandClasses: ['taskflow-close-write'],
    reason: 'already expired',
    ttlMs: 1000,
    now: '2026-07-24T00:00:00.000Z'
  });
  const expiredDecision = evaluateLaneCapability({
    cwd: repo,
    taskId,
    actorId: 'other-captain',
    commandClass: 'taskflow-close-write',
    executingLaneSessionId: expiredExecutorLane,
    now: '2026-07-24T01:00:00.000Z'
  });
  assert.equal(expiredDecision.decisionClass, 'borrowed-actor-blocked', 'expired receipt must not authorize');

  console.log('lane-capability-secrecy-and-proxy-execution.test.ts passed');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
