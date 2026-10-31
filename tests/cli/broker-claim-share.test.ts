// prereg v3 W4: `broker claim` CLI, per-command notice delivery and steward apply-live hooks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../../packages/cli/src/atm.ts';
import { readClaimEvents } from '../../packages/core/src/claim-share/claim-event-log.ts';
import { loadClaimShareRegistry } from '../../packages/core/src/claim-share/claim-share-store.ts';

const BASE = 'alpha\nbeta\ngamma\n';
const originalCwd = process.cwd();
const originalActor = process.env.ATM_ACTOR_ID;
const repo = mkdtempSync(path.join(tmpdir(), 'atm-claim-share-cli-'));

async function atm(args: string[], actor: string | null): Promise<{ ok: boolean; messages: { code: string; text: string; data?: Record<string, unknown> }[]; evidence: Record<string, unknown> }> {
  let stdout = '';
  if (actor) process.env.ATM_ACTOR_ID = actor; else delete process.env.ATM_ACTOR_ID;
  await runCli([...args, '--cwd', repo, '--json'], {
    stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
    stderr: { write: () => true }
  } as any);
  return JSON.parse(stdout);
}

function git(args: string[]): string {
  const result = spawnSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

try {
  writeFileSync(path.join(repo, 'shared.py'), BASE);
  writeFileSync(path.join(repo, '.gitignore'), '.atm/\n');
  git(['init', '-q']);
  git(['add', '--', 'shared.py', '.gitignore']);
  git(['-c', 'user.name=atm', '-c', 'user.email=atm@example.com', 'commit', '-q', '-m', 'base']);
  process.chdir(repo);

  // Off by default: claim refuses with a pointer to init; no runtime files appear.
  const off = await atm(['broker', 'claim', '--files', 'shared.py'], 'session-a');
  assert.equal(off.ok, false);
  assert.equal(off.messages[0]?.code, 'ATM_CLAIM_SHARE_INACTIVE');
  assert.equal(existsSync(path.join(repo, '.atm', 'runtime', 'claim-events.jsonl')), false);

  const init = await atm(['broker', 'claim', 'init'], null);
  assert.equal(init.ok, true);
  assert.equal(init.messages[0]?.code, 'ATM_CLAIM_SHARE_INITIALISED');

  const noActor = await atm(['broker', 'claim', '--files', 'shared.py'], null);
  assert.equal(noActor.ok, false);
  assert.equal(noActor.messages[0]?.code, 'ATM_CLI_USAGE');

  const granted = await atm(['broker', 'claim', '--files', 'shared.py'], 'session-a');
  assert.equal(granted.ok, true);
  assert.equal(granted.messages[0]?.code, 'CLAIM_GRANTED');

  // Overlap share via --actor; the message names the file only.
  const overlap = await atm(['broker', 'claim', '--files', 'shared.py,other.py', '--actor', 'session-b'], 'session-b');
  assert.equal(overlap.ok, true);
  assert.equal(overlap.messages[0]?.code, 'CLAIM_OVERLAP');
  assert.equal(overlap.messages[0]?.text, 'CLAIM_OVERLAP: shared.py will be merged via steward.');
  assert.equal(overlap.evidence.writeAuthorized, true);
  assert.deepEqual(overlap.evidence.files, ['shared.py', 'other.py']);

  // Holder learns through the output of its next atm command (any command; here `broker claim status`).
  const holderNext = await atm(['broker', 'claim', 'status'], 'session-a');
  assert.equal(holderNext.ok, true);
  const notice = holderNext.messages.find((entry) => entry.code === 'CLAIM_OVERLAP');
  assert.ok(notice, 'overlap notice is piggybacked on the holder\'s next command');
  assert.equal(notice.text, 'CLAIM_OVERLAP: shared.py will be merged via steward.');
  assert.equal((holderNext.evidence.claimShareNotices as unknown[]).length, 1);
  // Delivery also rides on failing commands, but there is nothing left to deliver now.
  const holderFail = await atm(['broker', 'claim', 'release', '--bogus'], 'session-a');
  assert.equal(holderFail.ok, false);
  assert.equal(holderFail.messages.some((entry) => entry.code === 'CLAIM_OVERLAP'), false);

  // apply-live: an unclaimed write by session-c is allowed, logged, auto-claimed and raises CLAIM_OVERLAP to the writer;
  // the accepted commit then releases that file from session-c's claim.
  const head = git(['rev-parse', 'HEAD']);
  writeFileSync(path.join(repo, 'proposal.json'), JSON.stringify({
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'claim share cli test' },
    proposalId: 'p-c-1',
    taskId: 'p-c-1',
    actorId: 'session-c',
    baseCommit: head,
    fileBeforeHash: `sha256:${createHash('sha256').update(BASE, 'utf8').digest('hex')}`,
    targetFile: 'shared.py',
    atomRefs: [{ atomId: 'atom-p-c-1', atomCid: 'cid-p-c-1' }],
    anchors: [{ kind: 'line-range', hint: '2-2' }],
    intent: 'p-c-1',
    patch: 'diff --git a/shared.py b/shared.py\n--- a/shared.py\n+++ b/shared.py\n@@ -2,1 +2,1 @@\n-beta\n+beta-c\n',
    validators: ['claim-share'],
    rollback: 'restore'
  }));
  const live = await atm(['broker', 'steward', 'apply-live', '--proposal-file', 'proposal.json', '--scope-file', 'shared.py'], 'session-c');
  assert.equal(live.ok, true, JSON.stringify(live.messages));
  assert.equal(live.messages[0]?.code, 'ATM_BROKER_LIVE_WRITE_APPLIED');
  assert.equal(live.messages.some((entry) => entry.code === 'CLAIM_OVERLAP' && entry.text === 'CLAIM_OVERLAP: shared.py will be merged via steward.'), true);
  assert.match(readFileSync(path.join(repo, 'shared.py'), 'utf8'), /beta-c/);
  const claimShare = live.evidence.claimShare as { unclaimedWrites: { actorId: string }[]; releasedFiles: string[] };
  assert.deepEqual(claimShare.unclaimedWrites.map((write) => write.actorId), ['session-c']);
  assert.deepEqual(claimShare.releasedFiles, ['shared.py']);
  assert.equal(loadClaimShareRegistry(repo).claims.some((claim) => claim.actorId === 'session-c'), false);

  const types = readClaimEvents(repo).map((event) => `${event.type}:${event.actorId}`);
  for (const expected of [
    'claim:session-a', 'claim:session-b', 'claim-overlap:session-b', 'overlap-notice-delivered:session-a',
    'unclaimed-write:session-c', 'claim:session-c', 'claim-overlap:session-c', 'steward-accept:session-c', 'release:session-c'
  ]) {
    assert.ok(types.includes(expected), `missing ${expected} in ${types.join(', ')}`);
  }
  assert.ok(types.indexOf('unclaimed-write:session-c') < types.indexOf('steward-accept:session-c'));
  assert.ok(types.indexOf('steward-accept:session-c') < types.indexOf('release:session-c'));
  // session-a and session-b get their notices about session-c's auto-claim on their next command.
  const bNext = await atm(['broker', 'claim', 'status'], 'session-b');
  assert.equal(bNext.messages.some((entry) => entry.code === 'CLAIM_OVERLAP'), true);
} finally {
  process.chdir(originalCwd);
  if (originalActor === undefined) delete process.env.ATM_ACTOR_ID; else process.env.ATM_ACTOR_ID = originalActor;
  rmSync(repo, { recursive: true, force: true });
}

console.log('[broker-claim-share.test] ok');
