// prereg v3 W4: file-level claim share layer + append-only claim event log.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  claimFiles,
  claimOverlapMessage,
  claimShareStatus,
  initClaimShare,
  recordStewardOutcomes,
  recordUnclaimedWrites,
  releaseClaimFiles,
  touchClaimShareActor
} from '../../packages/core/src/claim-share/claim-share.ts';
import { claimEventLogPath, readClaimEvents } from '../../packages/core/src/claim-share/claim-event-log.ts';
import { isClaimShareActive, loadClaimShareRegistry } from '../../packages/core/src/claim-share/claim-share-store.ts';

const T0 = Date.parse('2026-11-01T00:00:00.000Z');
let nowMs = T0;
const now = () => nowMs;
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'atm-claim-share-'));
  roots.push(root);
  return root;
}

try {
  // Layer is off until init: every entry point is a no-op and writes nothing.
  {
    const root = makeRoot();
    assert.equal(isClaimShareActive(root), false);
    assert.equal(claimFiles({ cwd: root, actorId: 'a', files: ['x.ts'], now }), null);
    assert.equal(touchClaimShareActor({ cwd: root, actorId: 'a', now }), null);
    assert.equal(recordUnclaimedWrites({ cwd: root, writes: [{ actorId: 'a', file: 'x.ts', proposalId: 'p' }], now }), null);
    assert.equal(existsSync(path.join(root, '.atm')), false);
    assert.deepEqual(initClaimShare(root), { created: true });
    assert.deepEqual(initClaimShare(root), { created: false });
  }

  // Overlap share: second claim is granted (no queue, no shrink) with a files-only CLAIM_OVERLAP.
  const root = makeRoot();
  initClaimShare(root);
  nowMs = T0;
  const first = claimFiles({ cwd: root, actorId: 'session-a', files: ['src/a.ts', './src/b.ts'], now });
  assert.ok(first);
  assert.equal(first.code, 'CLAIM_GRANTED');
  assert.deepEqual(first.files, ['src/a.ts', 'src/b.ts']);
  assert.equal(first.expiresAt, new Date(T0 + 900_000).toISOString(), 'default lease TTL is 900 s');

  nowMs = T0 + 10_000;
  const second = claimFiles({ cwd: root, actorId: 'session-b', files: ['src/b.ts', 'src/c.ts'], now });
  assert.ok(second);
  assert.equal(second.code, 'CLAIM_OVERLAP');
  assert.deepEqual(second.files, ['src/b.ts', 'src/c.ts'], 'share mode keeps every requested file');
  assert.deepEqual(second.overlapFiles, ['src/b.ts']);
  assert.equal(second.message, claimOverlapMessage(['src/b.ts']));
  assert.match(second.message, /src\/b\.ts/);
  assert.match(second.message, /will be merged via steward/);
  assert.doesNotMatch(second.message, /session-a|claim-\d/, 'overlap message names files only, never the other actor or claim');
  const registry = loadClaimShareRegistry(root);
  assert.equal(registry.claims.length, 2, 'both claims stay live');
  assert.equal(registry.pendingNotices.length, 1);
  assert.equal(registry.pendingNotices[0]?.holderActorId, 'session-a');

  // Re-claiming an already-held file does not raise a fresh overlap.
  nowMs = T0 + 11_000;
  const again = claimFiles({ cwd: root, actorId: 'session-b', files: ['src/b.ts'], now });
  assert.equal(again?.code, 'CLAIM_GRANTED');
  assert.equal(loadClaimShareRegistry(root).pendingNotices.length, 1);

  // Notice delivery: the holder learns on its next atm command, exactly once; others get nothing.
  nowMs = T0 + 20_000;
  const otherTouch = touchClaimShareActor({ cwd: root, actorId: 'session-b', now });
  assert.deepEqual(otherTouch?.notices, []);
  nowMs = T0 + 25_000;
  const holderTouch = touchClaimShareActor({ cwd: root, actorId: 'session-a', now });
  assert.ok(holderTouch);
  assert.equal(holderTouch.notices.length, 1);
  assert.equal(holderTouch.notices[0]?.code, 'CLAIM_OVERLAP');
  assert.deepEqual(holderTouch.notices[0]?.files, ['src/b.ts']);
  assert.doesNotMatch(holderTouch.notices[0]?.message ?? '', /session-b|claim-\d/);
  assert.deepEqual(touchClaimShareActor({ cwd: root, actorId: 'session-a', now })?.notices, [], 'a notice is delivered once');
  const delivered = readClaimEvents(root).filter((event) => event.type === 'overlap-notice-delivered');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.actorId, 'session-a');
  assert.equal(delivered[0]?.detail.latencyMs, 15_000);

  // TTL renew: every command of the holder pushes expiresAt to now + 900 s.
  nowMs = T0 + 600_000;
  const renewed = touchClaimShareActor({ cwd: root, actorId: 'session-a', now });
  assert.deepEqual(renewed?.renewedClaimIds, [first.claimId]);
  const renewedClaim = loadClaimShareRegistry(root).claims.find((claim) => claim.actorId === 'session-a');
  assert.equal(renewedClaim?.expiresAt, new Date(T0 + 600_000 + 900_000).toISOString());

  // TTL expire: session-b went quiet after T0 + 20 s, so its lease lapses at T0 + 920 s.
  nowMs = T0 + 1_000_000;
  const status = claimShareStatus({ cwd: root, now });
  assert.ok(status);
  assert.deepEqual(status.claims.map((claim) => claim.actorId), ['session-a']);
  assert.equal(status.expiredClaimIds.length, 1);
  const expire = readClaimEvents(root).find((event) => event.type === 'expire');
  assert.equal(expire?.actorId, 'session-b');
  assert.equal(expire?.detail.expiresAt, new Date(T0 + 20_000 + 900_000).toISOString(), 'expire keeps the original expiresAt');
  assert.equal(expire?.detail.detectedAt, new Date(T0 + 1_000_000).toISOString());

  // Unclaimed write: allowed, logged and auto-claimed; overlap with a live claim is raised to the writer.
  nowMs = T0 + 1_100_000;
  const unclaimed = recordUnclaimedWrites({
    cwd: root,
    now,
    writes: [
      { actorId: 'session-c', file: 'src/a.ts', proposalId: 'p-c-1' },
      { actorId: 'session-a', file: 'src/a.ts', proposalId: 'p-a-1' }
    ]
  });
  assert.ok(unclaimed);
  assert.deepEqual(unclaimed.unclaimed.map((write) => write.actorId), ['session-c'], 'a covered write is not unclaimed');
  assert.equal(unclaimed.overlaps.length, 1);
  assert.equal(unclaimed.overlaps[0]?.code, 'CLAIM_OVERLAP');
  const autoClaim = loadClaimShareRegistry(root).claims.find((claim) => claim.actorId === 'session-c');
  assert.equal(autoClaim?.source, 'unclaimed-write');
  assert.deepEqual(autoClaim?.files, ['src/a.ts']);
  const unclaimedEvent = readClaimEvents(root).find((event) => event.type === 'unclaimed-write');
  assert.equal(unclaimedEvent?.actorId, 'session-c');
  assert.deepEqual(unclaimedEvent?.files, ['src/a.ts']);
  assert.equal(unclaimedEvent?.detail.proposalId, 'p-c-1');

  // Steward outcomes: accept releases that file for that actor; reject keeps the claim.
  nowMs = T0 + 1_200_000;
  const outcomes = recordStewardOutcomes({
    cwd: root,
    now,
    writes: [
      { actorId: 'session-c', file: 'src/a.ts', proposalId: 'p-c-1', decision: 'accepted', reasonCode: null, commitSha: 'abc123' },
      { actorId: 'session-a', file: 'src/a.ts', proposalId: 'p-a-1', decision: 'rejected-by-design', reasonCode: 'overlapping-write-queued', commitSha: null }
    ]
  });
  assert.deepEqual(outcomes?.releasedFiles, ['src/a.ts']);
  const afterSteward = loadClaimShareRegistry(root).claims;
  assert.equal(afterSteward.find((claim) => claim.actorId === 'session-c'), undefined, 'empty claim is dropped after commit');
  assert.deepEqual(afterSteward.find((claim) => claim.actorId === 'session-a')?.files, ['src/a.ts', 'src/b.ts']);
  const stewardEvents = readClaimEvents(root).filter((event) => event.type === 'steward-accept' || event.type === 'steward-reject');
  assert.deepEqual(stewardEvents.map((event) => event.type), ['steward-accept', 'steward-reject']);
  assert.equal(stewardEvents[0]?.detail.commitSha, 'abc123');
  assert.equal(stewardEvents[1]?.detail.reasonCode, 'overlapping-write-queued');

  // Explicit release.
  nowMs = T0 + 1_300_000;
  assert.deepEqual(releaseClaimFiles({ cwd: root, actorId: 'session-a', files: ['src/b.ts'], now })?.releasedFiles, ['src/b.ts']);
  assert.deepEqual(releaseClaimFiles({ cwd: root, actorId: 'session-a', now })?.releasedFiles, ['src/a.ts']);
  assert.deepEqual(loadClaimShareRegistry(root).claims, []);

  // Event log: append-only, strictly increasing seq, ISO wall stamps and monotonic stamps, every event type seen.
  const logText = readFileSync(claimEventLogPath(root), 'utf8');
  const events = readClaimEvents(root);
  assert.ok(logText.endsWith('\n'));
  assert.equal(logText.split('\n').filter(Boolean).length, events.length);
  events.forEach((event, index) => {
    assert.equal(event.schemaId, 'atm.claimEvent.v1');
    assert.equal(event.seq, index + 1, 'seq is gap-free and strictly increasing');
    assert.equal(new Date(event.at).toISOString(), event.at, 'at is an ISO timestamp');
    assert.match(event.monoNs, /^\d+$/);
    if (index > 0) {
      assert.ok(BigInt(event.monoNs) >= BigInt(events[index - 1]!.monoNs), 'monoNs never goes back');
      assert.ok(Date.parse(event.at) >= Date.parse(events[index - 1]!.at));
    }
  });
  for (const type of ['claim', 'claim-overlap', 'overlap-notice-delivered', 'renew', 'expire', 'release', 'unclaimed-write', 'steward-accept', 'steward-reject']) {
    assert.ok(events.some((event) => event.type === type), `event log has ${type}`);
  }
  const prefix = logText;
  nowMs = T0 + 1_400_000;
  claimFiles({ cwd: root, actorId: 'session-d', files: ['src/d.ts'], now });
  const grown = readFileSync(claimEventLogPath(root), 'utf8');
  assert.ok(grown.length > prefix.length && grown.startsWith(prefix), 'later operations only append to the log');
  assert.equal(loadClaimShareRegistry(root).nextSeq, readClaimEvents(root).length + 1);
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log('[claim-share.test] ok');
