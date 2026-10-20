// #360 — original-intent anchoring: a write that deletes or modifies lines
// another session committed since the writer's anchor base is rejected with
// `cross-session-overlap`, names that session and shows its diff, and leaves
// the file untouched. A fresh base hash alone is not grounds to accept.
//
// Covers #360 AC8: delete / modify the other session's line, the v10c rec 3-5
// replay (fixtures from tests/fixtures/unified-patch-v10c, header counts
// corrected as in unified-patch-v10c-replay), a resubmission that keeps the
// other change, disjoint edits, same-actor re-edit, --ack-overlap (right and
// wrong proposal id), a rec-4-style context mismatch caused by another session,
// and stubbed multi-session concurrency (child processes racing on one file).
//
// Runnable directly via: node --strip-types tests/core/cross-session-overlap.test.ts
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLiveQueuedWrites, type LiveQueuedWrite } from '../../packages/core/src/live-write/live-queued-write.ts';
import type { PatchProposal } from '../../packages/core/src/broker/types.ts';
import { runBroker } from '../../packages/cli/src/commands/broker.ts';

const FILE = 'shared.py';
const BASE = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

if (process.env.CSO_WORKER === '1') {
  runSessionWorker(Number(process.env.CSO_WORKER_ID), process.env.CSO_WORKDIR || '');
} else {
  await main();
}

async function main() {
  deleteOtherSessionsLine();
  modifyOtherSessionsLine();
  disjointAndSameActor();
  acknowledgement();
  staleContextCausedByOtherSession();
  v10cReplay();
  reviewRegressions();
  await cliSurface();
  const concurrency = await stubbedMultiSessionConcurrency(6);
  console.log(JSON.stringify({ concurrency }));
  console.log('cross-session overlap ok');
}

function deleteOtherSessionsLine() {
  const repo = makeRepo(FILE, BASE);
  const base = hashText(BASE);
  // Session B anchors on the original file, then A modifies line 3 and commits.
  assert.equal(write(repo, { id: 'b-1', actor: 'session-b', hash: base, patch: replace(BASE, 6, 'six', 'six-b') }).decision, 'accepted');
  const afterB = read(repo);
  const a1 = write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(afterB), patch: replace(afterB, 3, 'three', 'three-a') });
  assert.equal(a1.decision, 'accepted');
  const afterA = read(repo);
  // B resubmits against the fresh base, deleting A's committed line: rejected, file untouched.
  const b2 = write(repo, { id: 'b-2', actor: 'session-b', hash: hashText(afterA), patch: remove(afterA, 3, ['three-a']) });
  assertOverlap(b2, 'session-a', 'a-1');
  assert.equal(read(repo), afterA);
  assert.match(b2.crossSessionOverlap![0]!.diff, /^-three\n\+three-a$/m);
  assert.deepEqual(b2.crossSessionOverlap![0]!.currentLines, [{ start: 3, end: 3 }]);
  assert.match(b2.detail, /session session-a \(proposal a-1, commit [0-9a-f]{40}\)/);
  assert.match(b2.instruction ?? '', /merge both intents/);
  assert.equal(b2.crossSessionOverlap![0]!.commitSha, a1.commitSha);
  const queue = readJsonl(repo, 'live-write-queue.jsonl');
  assert.equal(queue.at(-1).reasonCode, 'cross-session-overlap');
  assert.equal(queue.at(-1).overlaps[0].actorId, 'session-a');
  // Every resubmission stays rejected whatever its base hash.
  assertOverlap(write(repo, { id: 'b-3', actor: 'session-b', hash: hashText(afterA), patch: remove(afterA, 3, ['three-a']) }), 'session-a', 'a-1');
  // The window is the actor's task: a new task that starts from the current file anchors there.
  const fresh = write(repo, { id: 'b-4', actor: 'session-b', task: 'task-b-next', hash: hashText(afterA), patch: remove(afterA, 3, ['three-a']) });
  assert.equal(fresh.decision, 'accepted', fresh.detail);
}

function modifyOtherSessionsLine() {
  const repo = makeRepo(FILE, BASE);
  const base = hashText(BASE);
  write(repo, { id: 'b-0', actor: 'session-b', hash: base, patch: replace(BASE, 8, 'eight', 'eight-b') });
  const afterB = read(repo);
  assert.equal(write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(afterB), patch: replace(afterB, 2, 'two', 'two-a') }).decision, 'accepted');
  const afterA = read(repo);
  assertOverlap(write(repo, { id: 'b-1', actor: 'session-b', hash: hashText(afterA), patch: replace(afterA, 2, 'two-a', 'two-b') }), 'session-a', 'a-1');
  assert.equal(read(repo), afterA);
  // Merge both intents: a patch that keeps A's line (adds next to it) is accepted.
  const merged = write(repo, { id: 'b-2', actor: 'session-b', hash: hashText(afterA), patch: insertAfter(afterA, 2, 'two-a', 'two-b-also') });
  assert.equal(merged.decision, 'accepted', merged.detail);
  assert.match(read(repo), /two-a\ntwo-b-also\n/);
}

function disjointAndSameActor() {
  const repo = makeRepo(FILE, BASE);
  const base = hashText(BASE);
  write(repo, { id: 'b-0', actor: 'session-b', hash: base, patch: replace(BASE, 1, 'one', 'one-b') });
  let text = read(repo);
  assert.equal(write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(text), patch: replace(text, 4, 'four', 'four-a') }).decision, 'accepted');
  text = read(repo);
  // Disjoint fresh-base edit by B passes.
  assert.equal(write(repo, { id: 'b-1', actor: 'session-b', hash: hashText(text), patch: replace(text, 7, 'seven', 'seven-b') }).decision, 'accepted');
  text = read(repo);
  // Same-actor re-edit: A rewrites and then deletes its own committed line.
  assert.equal(write(repo, { id: 'a-2', actor: 'session-a', hash: hashText(text), patch: replace(text, 4, 'four-a', 'four-a2') }).decision, 'accepted');
  text = read(repo);
  assert.equal(write(repo, { id: 'a-3', actor: 'session-a', hash: hashText(text), patch: remove(text, 4, ['four-a2']) }).decision, 'accepted');
  // Disjoint stale-base edit (translated, #363) by B passes too, offset by A's deletion.
  const stale = write(repo, { id: 'b-2', actor: 'session-b', hash: hashText(text), patch: replace(text, 8, 'eight', 'eight-b') });
  assert.equal(stale.decision, 'accepted', stale.detail);
  assert.equal(read(repo), 'one-b\ntwo\nthree\nfive\nsix\nseven-b\neight-b\n');
}

function acknowledgement() {
  const repo = makeRepo(FILE, BASE);
  write(repo, { id: 'b-0', actor: 'session-b', hash: hashText(BASE), patch: replace(BASE, 8, 'eight', 'eight-b') });
  let text = read(repo);
  write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(text), patch: replace(text, 5, 'five', 'five-a') });
  text = read(repo);
  const patch = replace(text, 5, 'five-a', 'five-b');
  const missing = write(repo, { id: 'b-1', actor: 'session-b', hash: hashText(text), patch });
  assertOverlap(missing, 'session-a', 'a-1');
  const wrong = write(repo, { id: 'b-2', actor: 'session-b', hash: hashText(text), patch }, ['a-999']);
  assertOverlap(wrong, 'session-a', 'a-1');
  assert.match(wrong.detail, /--ack-overlap a-999 does not name a-1/);
  assert.equal(read(repo), text);
  const acked = write(repo, { id: 'b-3', actor: 'session-b', hash: hashText(text), patch }, ['a-1']);
  assert.equal(acked.decision, 'accepted', acked.detail);
  assert.deepEqual(acked.acknowledgedOverlap, ['a-1']);
  const journal = readJsonl(repo, 'live-write-journal.jsonl');
  assert.deepEqual(journal.at(-1).acknowledgedOverlap, ['a-1']);
  assert.equal(journal.at(-1).actorId, 'session-b');
  assert.match(read(repo), /five-b/);
}

function staleContextCausedByOtherSession() {
  const repo = makeRepo(FILE, BASE);
  // B anchors on the original file (its first proposal is malformed; it still declares what B saw).
  const malformed = write(repo, { id: 'b-0', actor: 'session-b', hash: hashText(BASE), patch: 'not a patch\n' });
  assert.equal(malformed.reasonCode, 'patch-malformed');
  write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(BASE), patch: replace(BASE, 4, 'four', 'four-a') });
  const text = read(repo);
  // B still carries the original line 4 but declares the fresh hash: the context no longer matches,
  // because A changed exactly that line. That is A's overlap, not a generic mismatch.
  const stale = write(repo, { id: 'b-1', actor: 'session-b', hash: hashText(text), patch: remove(BASE, 4, ['four']) });
  assertOverlap(stale, 'session-a', 'a-1');
  // A mismatch that no other session caused stays patch-context-mismatch.
  const plain = write(repo, { id: 'b-2', actor: 'session-b', hash: hashText(text), patch: remove(BASE, 6, ['no-such-line']) });
  assert.equal(plain.reasonCode, 'patch-context-mismatch');
  assert.equal(read(repo), text);
}

function v10cReplay() {
  const fixtures = path.join(root, 'tests', 'fixtures', 'unified-patch-v10c');
  const file = 'django/db/migrations/loader.py';
  const base0 = readFileSync(path.join(fixtures, 'base-7dca66d2.txt'), 'utf8');
  const base1 = readFileSync(path.join(fixtures, 'base-9d85b779.txt'), 'utf8');
  const repo = makeRepo(file, base0);
  const slot1 = 'prereg-session-slot-1';
  const slot2 = 'prereg-session-slot-2';
  // rec 2: slot-2's first proposal declares base 7dca66d2 (rejected as malformed; it still anchors slot-2).
  const rec2 = write(repo, { id: 'rec2', actor: slot2, hash: hashText(base0), file, patch: readFileSync(path.join(fixtures, 'rec2.patch'), 'utf8') });
  assert.equal(rec2.decision, 'rejected-by-design');
  // rec 3: slot-1 refines line 93 (7dca66d2 -> 9d85b779).
  const rec3 = write(repo, { id: 'rec3', actor: slot1, hash: hashText(base0), file, patch: lineDiff(file, base0, base1) });
  assert.equal(rec3.decision, 'accepted', rec3.detail);
  assert.equal(hashText(read(repo, file)), hashText(base1));
  assert.ok(hashText(base1).startsWith('sha256:9d85b779'));
  // rec 4 (header count corrected): slot-2 still carries the original line 93 and declares the fresh hash.
  const rec4 = write(repo, { id: 'rec4', actor: slot2, hash: hashText(base1), file, patch: readFileSync(path.join(fixtures, 'rec4.patch'), 'utf8').replace('@@ -91,9 +91,5 @@', '@@ -91,9 +91,6 @@') });
  assertOverlap(rec4, slot1, 'rec3');
  // rec 5: slot-2 deletes slot-1's modified line 93 and the two after it against 9d85b779. CLI 0.1.21 accepted it.
  const rec5Patch = readFileSync(path.join(fixtures, 'rec5.patch'), 'utf8').replace('@@ -90,10 +90,6 @@', '@@ -90,9 +90,6 @@');
  const rec5 = write(repo, { id: 'rec5', actor: slot2, hash: hashText(base1), file, patch: rec5Patch });
  assertOverlap(rec5, slot1, 'rec3');
  assert.deepEqual(rec5.crossSessionOverlap![0]!.currentLines, [{ start: 93, end: 93 }]);
  assert.match(rec5.crossSessionOverlap![0]!.diff, /^\+ +if getattr\(module, '__file__', None\) is None and not isinstance/m);
  assert.equal(hashText(read(repo, file)), hashText(base1), 'slot-1 line 93 survives');
  // Explicit override with the right proposal id goes through and is recorded.
  const acked = write(repo, { id: 'rec5-ack', actor: slot2, hash: hashText(base1), file, patch: rec5Patch }, ['rec3']);
  assert.equal(acked.decision, 'accepted', acked.detail);
  assert.deepEqual(readJsonl(repo, 'live-write-journal.jsonl').at(-1).acknowledgedOverlap, ['rec3']);
}

function reviewRegressions() {
  // Duplicate lines keep their provenance: A's owned line and A's later identical copy are both protected.
  {
    const text0 = 'left\nold\nright\nend\n';
    const repo = makeRepo(FILE, text0);
    write(repo, { id: 'b-0', actor: 'session-b', hash: hashText(text0), patch: replace(text0, 4, 'end', 'end-b') });
    let text = read(repo);
    assert.equal(write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(text), patch: replace(text, 2, 'old', 'owned') }).decision, 'accepted');
    text = read(repo);
    assert.equal(write(repo, { id: 'a-2', actor: 'session-a', hash: hashText(text), patch: `${header()}@@ -1,1 +1,2 @@\n left\n+owned\n` }).decision, 'accepted');
    text = read(repo);
    assert.equal(text, 'left\nowned\nowned\nright\nend-b\n');
    const second = write(repo, { id: 'b-1', actor: 'session-b', hash: hashText(text), patch: remove(text, 3, ['owned']) });
    assertOverlap(second, 'session-a', 'a-1');
    const first = write(repo, { id: 'b-2', actor: 'session-b', hash: hashText(text), patch: remove(text, 2, ['owned']) });
    assertOverlap(first, 'session-a', 'a-2');
  }
  // An anchor older than the journal chain (an ordinary commit came between) still sees A's later steward write.
  {
    const repo = makeRepo(FILE, BASE);
    const h1 = BASE.replace('eight', 'eight-ordinary');
    writeFileSync(path.join(repo, FILE), h1);
    git(repo, ['-c', 'user.name=atm', '-c', 'user.email=atm@example.com', 'commit', '-q', '-am', 'ordinary']);
    assert.equal(write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(h1), patch: replace(h1, 2, 'two', 'two-a') }).decision, 'accepted');
    const text = read(repo);
    const first = write(repo, { id: 'b-1', actor: 'session-b', hash: hashText(BASE), patch: replace(BASE, 6, 'six', 'six-b') });
    assert.equal(first.decision, 'rejected-by-design', 'stale first proposal without prior same-base commits stays stale-base');
    assertOverlap(write(repo, { id: 'b-2', actor: 'session-b', hash: hashText(text), patch: replace(text, 2, 'two-a', 'two-b') }), 'session-a', 'a-1');
  }
  // Keeping another session's deletion is not an overlap: B rewrites only the untouched neighbours.
  {
    const text0 = 'left\ndeleted\nright\nend\n';
    const repo = makeRepo(FILE, text0);
    write(repo, { id: 'b-0', actor: 'session-b', hash: hashText(text0), patch: replace(text0, 4, 'end', 'end-b') });
    let text = read(repo);
    assert.equal(write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(text), patch: remove(text, 2, ['deleted']) }).decision, 'accepted');
    text = read(repo);
    const kept = write(repo, { id: 'b-1', actor: 'session-b', hash: hashText(text), patch: `${header()}@@ -1,2 +1,2 @@\n-left\n-right\n+LEFT\n+RIGHT\n` });
    assert.equal(kept.decision, 'accepted', kept.detail);
    assert.equal(read(repo), 'LEFT\nRIGHT\nend-b\n');
  }
}

async function cliSurface() {
  const repo = makeRepo(FILE, BASE);
  write(repo, { id: 'b-0', actor: 'session-b', hash: hashText(BASE), patch: replace(BASE, 8, 'eight', 'eight-b') });
  let text = read(repo);
  write(repo, { id: 'a-1', actor: 'session-a', hash: hashText(text), patch: replace(text, 2, 'two', 'two-a') });
  text = read(repo);
  const proposalPath = path.join(repo, 'b-1.proposal.json');
  writeFileSync(proposalPath, JSON.stringify(proposal({ id: 'b-1', actor: 'session-b', hash: hashText(text), patch: remove(text, 2, ['two-a']) })));
  const rejectedResult = await runBroker(['steward', 'apply-live', '--cwd', repo, '--proposal-file', 'b-1.proposal.json', '--scope-file', FILE]) as any;
  assert.equal(rejectedResult.ok, false);
  assert.equal(rejectedResult.messages[0].code, 'ATM_BROKER_LIVE_WRITE_CROSS_SESSION_OVERLAP');
  assert.deepEqual(rejectedResult.messages[0].data.crossSessionOverlap.map((item: any) => item.actorId), ['session-a']);
  assert.equal(rejectedResult.evidence.liveWrites[0].reasonCode, 'cross-session-overlap');
  writeFileSync(proposalPath, JSON.stringify(proposal({ id: 'b-2', actor: 'session-b', hash: hashText(text), patch: remove(text, 2, ['two-a']) })));
  const acked = await runBroker(['steward', 'apply-live', '--cwd', repo, '--proposal-file', 'b-1.proposal.json', '--scope-file', FILE, '--ack-overlap', 'a-1']) as any;
  assert.equal(acked.ok, true, JSON.stringify(acked.messages));
  assert.deepEqual(acked.messages[0].data.acknowledgedOverlap, ['a-1']);
}

/**
 * Stubbed sessions in separate processes race on one file. Each first tries to
 * claim the shared line from the original base it saw, then edits its own line
 * several times (same-actor re-edits). Exactly one session's shared value
 * survives; every other session's resubmission is rejected with
 * cross-session-overlap naming that winner, and it abandons; no own-line edit is lost.
 */
async function stubbedMultiSessionConcurrency(workers: number) {
  const lines = ['shared: v0', ...Array.from({ length: workers }, (_, i) => `own-${i}: v0`)];
  const repo = makeRepo(FILE, `${lines.join('\n')}\n`);
  const children = Array.from({ length: workers }, (_, worker) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--strip-types', fileURLToPath(import.meta.url)], {
      env: { ...process.env, CSO_WORKER: '1', CSO_WORKER_ID: String(worker), CSO_WORKDIR: repo, CSO_BASE: `${lines.join('\n')}\n` }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  }));
  const results = await Promise.all(children);
  const failures = results.filter((child) => child.status !== 0);
  assert.equal(failures.length, 0, failures.map((child) => `${child.stdout}\n${child.stderr}`).join('\n'));
  const reports = results.map((child) => JSON.parse(child.stdout.trim().split('\n').pop()!));
  const finalText = read(repo);
  const winners = reports.filter((report) => report.shared === 'won');
  assert.equal(winners.length, 1, JSON.stringify(reports));
  const winner = `stub-session-${winners[0].worker}`;
  assert.match(finalText, new RegExp(`^shared: ${winner}$`, 'm'));
  for (const report of reports.filter((item) => item.shared !== 'won')) {
    assert.equal(report.shared, 'abandoned');
    assert.equal(report.overlapActor, winner, 'the rejection names the session that changed the line');
  }
  for (let worker = 0; worker < workers; worker += 1) assert.match(finalText, new RegExp(`^own-${worker}: v3$`, 'm'));
  return { workers, winner, retries: reports.reduce((sum, report) => sum + report.retries, 0) };
}

function runSessionWorker(worker: number, cwd: string) {
  const actor = `stub-session-${worker}`;
  const seen = process.env.CSO_BASE || '';
  let retries = 0;
  let shared = 'pending';
  let overlapActor: string | null = null;
  let declared = hashText(seen);
  let patch = replace(seen, 1, 'shared: v0', `shared: ${actor}`);
  for (let attempt = 0; shared === 'pending' && attempt < 400; attempt += 1) {
    const result = write(cwd, { id: `${actor}-shared-${attempt}`, actor, hash: declared, patch });
    if (result.decision === 'accepted') { shared = 'won'; break; }
    if (result.reasonCode === 'cross-session-overlap') {
      overlapActor = result.crossSessionOverlap![0]!.actorId;
      shared = 'abandoned';
      break;
    }
    assert.ok(['overlapping-write-queued', 'stale-base'].includes(String(result.reasonCode)), `${result.reasonCode}: ${result.detail}`);
    // Re-read and resubmit the same intent against the fresh file.
    retries += 1;
    const text = result.currentFileText ?? read(cwd);
    declared = hashText(text);
    const sharedLine = text.split('\n').findIndex((line) => line.startsWith('shared: '));
    patch = replace(text, sharedLine + 1, text.split('\n')[sharedLine]!, `shared: ${actor}`);
  }
  for (let version = 1; version <= 3; version += 1) {
    let done = false;
    for (let attempt = 0; !done && attempt < 400; attempt += 1) {
      const text = read(cwd);
      const index = text.split('\n').findIndex((line) => line.startsWith(`own-${worker}: `));
      const result = write(cwd, { id: `${actor}-own-v${version}-${attempt}`, actor, hash: hashText(text), patch: replace(text, index + 1, text.split('\n')[index]!, `own-${worker}: v${version}`) });
      if (result.decision === 'accepted') { done = true; break; }
      assert.ok(['overlapping-write-queued', 'stale-base'].includes(String(result.reasonCode)), `own edit ${result.reasonCode}: ${result.detail}`);
      retries += 1;
    }
    if (!done) throw new Error(`${actor} lost own edit v${version}`);
  }
  process.stdout.write(`${JSON.stringify({ worker, shared, overlapActor, retries })}\n`);
}

function assertOverlap(result: LiveQueuedWrite, actor: string, proposalId: string) {
  assert.equal(result.decision, 'rejected-by-design', result.detail);
  assert.equal(result.reasonCode, 'cross-session-overlap', result.detail);
  assert.equal(result.verdict, 'blocked');
  assert.ok(result.crossSessionOverlap && result.crossSessionOverlap.length > 0);
  assert.equal(result.crossSessionOverlap[0]!.actorId, actor);
  assert.equal(result.crossSessionOverlap[0]!.proposalId, proposalId);
  assert.ok(result.detail.includes(actor));
  assert.equal(typeof result.currentFileText, 'string');
}

function write(cwd: string, input: { id: string; actor: string; hash: string; patch: string; file?: string; task?: string }, ack: string[] = []): LiveQueuedWrite {
  const file = input.file ?? FILE;
  const result = applyLiveQueuedWrites({ cwd, proposals: [proposal({ ...input, file })], scopeFiles: [file], ackOverlap: ack });
  return result.writes[0]!;
}

function proposal(input: { id: string; actor: string; hash: string; patch: string; file?: string; task?: string }): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'cross-session overlap test' },
    proposalId: input.id,
    taskId: input.task ?? `task-${input.actor}`,
    actorId: input.actor,
    baseCommit: 'HEAD',
    fileBeforeHash: input.hash,
    targetFile: input.file ?? FILE,
    atomRefs: [{ atomId: `atom-${input.id}`, atomCid: `cid-${input.id}` }],
    anchors: [{ kind: 'line-range', hint: '1-1' }],
    intent: input.id,
    patch: input.patch,
    validators: ['cross-session-overlap'],
    rollback: 'restore'
  };
}

function header(file = FILE) {
  return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n`;
}

function replace(_text: string, lineNo: number, before: string, after: string, file = FILE): string {
  return `${header(file)}@@ -${lineNo},1 +${lineNo},1 @@\n-${before}\n+${after}\n`;
}

function remove(_text: string, lineNo: number, removed: string[], file = FILE): string {
  return `${header(file)}@@ -${lineNo},${removed.length} +${lineNo - 1},0 @@\n${removed.map((line) => `-${line}`).join('\n')}\n`;
}

function insertAfter(_text: string, lineNo: number, context: string, added: string): string {
  return `${header()}@@ -${lineNo},1 +${lineNo},2 @@\n ${context}\n+${added}\n`;
}

/** A single-hunk patch for two texts that differ in one contiguous block (zero context). */
function lineDiff(file: string, before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const removed = a.slice(start, endA);
  const added = b.slice(start, endB);
  return `${header(file)}@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@\n${removed.map((line) => `-${line}`).join('\n')}\n${added.map((line) => `+${line}`).join('\n')}\n`;
}

function makeRepo(file: string, text: string): string {
  const cwd = mkdtempSync(path.join(tmpdir(), 'cross-session-'));
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), text);
  git(cwd, ['init', '-q']);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=atm', '-c', 'user.email=atm@example.com', 'commit', '-q', '-m', 'base']);
  return cwd;
}

function read(cwd: string, file = FILE): string {
  return readFileSync(path.join(cwd, file), 'utf8');
}

function readJsonl(cwd: string, name: string): any[] {
  return readFileSync(path.join(cwd, '.atm', 'runtime', name), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}
