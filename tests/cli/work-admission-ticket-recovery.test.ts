import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  captureWorkAdmissionSnapshot,
  cleanupWorkAdmissionSnapshots,
  issueWorkAdmissionTicket,
  recoverUnattributedMutation
} from '../../packages/core/src/broker/work-admission-ticket.ts';

const rootDir = mkdtempSync(path.join(os.tmpdir(), 'atm-work-admission-'));
const ticket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0018',
  actorId: 'worker-a',
  laneSessionId: 'lane-a',
  claimGeneration: 'lease-a',
  allowedFiles: ['tracked.ts', 'new.ts'],
  requestedRecoveryMode: 'enabled',
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'atm.mjs@abc', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});

const baseline = captureWorkAdmissionSnapshot({
  rootDir,
  ticket,
  point: 'claim-baseline',
  sources: [
    { path: 'tracked.ts', state: 'clean-tracked', gitBlobId: 'abc123' },
    { path: 'new.ts', state: 'untracked', content: 'original-content' }
  ],
  handoffPinned: true,
  now: '2026-07-29T00:00:00.000Z'
});

assert.equal(baseline.entries[0]?.kind, 'git-blob-reference');
assert.equal(baseline.entries[0]?.byteLength, 0);
const compressed = baseline.entries.find((entry) => entry.kind === 'compressed-preimage');
assert(compressed?.objectPath);
assert.equal(inflateSync(readFileSync(compressed.objectPath!)).toString('utf8'), 'original-content');
assert.equal(baseline.expiresAt, '2026-08-05T00:00:00.000Z');

const preRisk = captureWorkAdmissionSnapshot({
  rootDir,
  ticket,
  point: 'pre-risk',
  sources: [{ path: 'new.ts', state: 'dirty-tracked', content: 'before-risk' }],
  existingTaskBytes: baseline.compressedBytes,
  existingRepositoryBytes: baseline.compressedBytes,
  now: '2026-07-29T00:01:00.000Z'
});
assert.equal(preRisk.point, 'pre-risk');

assert.throws(() => captureWorkAdmissionSnapshot({
  rootDir,
  ticket,
  point: 'pre-risk',
  sources: [{ path: 'new.ts', state: 'untracked', content: randomBytes(17 * 1024 * 1024).toString('base64') }],
  existingTaskBytes: baseline.compressedBytes + preRisk.compressedBytes,
  existingRepositoryBytes: baseline.compressedBytes + preRisk.compressedBytes
}), /ATM_WORK_ADMISSION_SNAPSHOT_BUDGET_EXCEEDED/);

assert.equal(recoverUnattributedMutation({ inScope: true }).disposition, 'late-attach');
assert.equal(recoverUnattributedMutation({ inScope: false }).disposition, 'split');
assert.equal(recoverUnattributedMutation({ inScope: true, nativeCommit: true }).disposition, 'historical-delivery-review');

const removed = cleanupWorkAdmissionSnapshots({ rootDir, taskId: ticket.taskId, ticketId: ticket.ticketId });
assert.equal(removed.length, 1);
assert.equal(existsSync(path.join(rootDir, ticket.taskId, ticket.ticketId)), false);
assert.deepEqual(cleanupWorkAdmissionSnapshots({ rootDir, taskId: ticket.taskId, ticketId: ticket.ticketId }), []);
rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({ marker: '[work-admission-ticket-recovery.test] ok', compressedBytes: baseline.compressedBytes + preRisk.compressedBytes }));
