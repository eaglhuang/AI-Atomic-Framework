import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashContent } from '../../packages/core/src/broker/adapters/cas.ts';
import type { PatchProposal } from '../../packages/core/src/broker/types.ts';
import { applyLiveQueuedWrites } from '../../packages/core/src/live-write/live-queued-write.ts';
import { appendJournal, readJournal, isCommitted, journalPath } from '../../packages/core/src/live-write/live-write-journal-store.ts';
import { runBroker } from '../../packages/cli/src/commands/broker.ts';

const repos: string[] = [];
const started = Date.now();
if (process.env.COMMIT_PATH_WORKER) {
  const cwd = process.env.COMMIT_PATH_REPO!;
  const file = `f${process.env.COMMIT_PATH_WORKER}.txt`;
  for (let iteration = 0; iteration < 15; iteration += 1) {
    const p = proposal(cwd, file, `${file}-${iteration}`, String(iteration));
    const result = applyLiveQueuedWrites({ cwd, proposals: [p] }).writes[0]!;
    assert.equal(result.decision, 'accepted', JSON.stringify(result));
    assert.equal(git(cwd, ['log', '-1', '--format=%s', result.commitSha!]), `steward live write ${p.proposalId}`);
  }
} else {
  try {
    await concurrency();
    journalCorruption();
    recovery();
    foreignIndex();
    await cliLabels();
    assert.ok(Date.now() - started < 60_000, 'commit path test must stay below 60s');
    console.log(`commit path ok: 8x15 accepted, 100% own SHA, journal recovery, CLI labels (${Date.now() - started}ms)`);
  } finally { for (const repo of repos) rmSync(repo, { recursive: true, force: true }); }
}
function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-C', cwd, '-c', 'user.name=test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return r.stdout.trim();
}
function repo(files = 1): string {
  const cwd = mkdtempSync(path.join(tmpdir(), 'codex364-'));
  repos.push(cwd);
  git(cwd, ['init', '-q']);
  for (let i = 0; i < files; i += 1) writeFileSync(path.join(cwd, `f${i}.txt`), 'seed\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-qm', 'base']);
  return cwd;
}
function proposal(cwd: string, file = 'f0.txt', id = 'p', after = 'next', before?: string): PatchProposal {
  const text = before ?? (existsSync(path.join(cwd, file)) ? readFileSync(path.join(cwd, file), 'utf8') : 'seed\n');
  return {
    schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: '364' },
    proposalId: id, taskId: 'task', actorId: file, baseCommit: git(cwd, ['rev-parse', 'HEAD']),
    fileBeforeHash: hashContent(text), targetFile: file,
    atomRefs: [{ atomId: 'a', atomCid: 'c' }], anchors: [{ kind: 'line-range', hint: '1-1' }],
    intent: id, patch: `@@ -1 +1 @@\n-${text.trim()}\n+${after}\n`, validators: ['test'], rollback: 'restore'
  };
}
async function concurrency() {
  const cwd = repo(8);
  await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--strip-types', fileURLToPath(import.meta.url)], {
      env: { ...process.env, COMMIT_PATH_WORKER: String(i), COMMIT_PATH_REPO: cwd }
    });
    let output = '';
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });
    child.on('error', reject);
    child.on('close', (status) => { if (status === 0) resolve(); else reject(new Error(output)); });
  })));
  assert.equal(readJournal(cwd).filter(isCommitted).length, 120);
}
function write(cwd: string, p = proposal(cwd)) {
  return applyLiveQueuedWrites({ cwd, proposals: [p] }).writes[0]!;
}
function journalCorruption() {
  for (const tail of ['{"torn":', 'bad\n', '{"complete":true}']) {
    const cwd = repo();
    mkdirSync(path.dirname(journalPath(cwd)), { recursive: true });
    writeFileSync(journalPath(cwd), tail);
    assert.equal(write(cwd).decision, 'accepted');
    assert.equal(write(cwd, proposal(cwd, 'f0.txt', 'second', 'third')).decision, 'accepted');
  }
  const cwd = repo();
  mkdirSync(path.dirname(journalPath(cwd)), { recursive: true });
  writeFileSync(journalPath(cwd), 'bad\n{}\n');
  const result = write(cwd);
  assert.equal(result.reasonCode, 'recovery-required');
  assert.equal(result.decision, 'rejected-by-design');
  assert.equal(result.queued, false);
  assert.equal(readFileSync(path.join(cwd, 'f0.txt'), 'utf8'), 'seed\n');
}
function recovery() {
  for (const state of ['after', 'base', 'neither', 'already-committed']) {
    const cwd = repo();
    const backup = '.atm/runtime/live-write-backups/crash.bak';
    mkdirSync(path.dirname(path.join(cwd, backup)), { recursive: true });
    writeFileSync(path.join(cwd, backup), 'seed\n');
    appendJournal(cwd, {
      kind: 'intent', file: 'f0.txt', proposalId: 'original', actorId: 'f0.txt',
      baseHash: hashContent('seed\n'), afterHash: hashContent('dangling\n'), changedLines: [0, 1], backup
    });
    const text = state === 'base' ? 'seed\n' : state === 'neither' ? 'unknown\n' : 'dangling\n';
    writeFileSync(path.join(cwd, 'f0.txt'), text);
    if (state === 'already-committed') {
      git(cwd, ['add', 'f0.txt']);
      git(cwd, ['commit', '-qm', 'steward live write original']);
      git(cwd, ['commit', '--allow-empty', '-qm', 'unrelated HEAD']);
    }
    const result = write(cwd);
    if (state === 'neither') {
      assert.equal(result.reasonCode, 'recovery-required');
      assert.equal(result.decision, 'rejected-by-design');
      assert.equal(result.queued, false);
      assert.equal(readFileSync(path.join(cwd, 'f0.txt'), 'utf8'), text);
      assert.ok(existsSync(path.join(cwd, backup)));
    } else {
      assert.equal(result.decision, 'accepted', JSON.stringify(result));
      assert.equal(existsSync(path.join(cwd, backup)), false);
      const entries = readJournal(cwd);
      if (state === 'base') assert.ok(entries.some((e) => e.kind === 'abandoned' && e.proposalId === 'original'));
      else {
        const original = entries.filter(isCommitted).find((e) => e.proposalId === 'original')!;
        assert.equal(git(cwd, ['log', '-1', '--format=%s', original.commitSha!]), 'steward live write original');
        assert.ok(original.blocks?.length);
      }
    }
  }
}
function foreignIndex() {
  const cwd = repo();
  writeFileSync(path.join(cwd, '.git/index.lock'), 'foreign');
  const result = write(cwd);
  assert.equal(result.decision, 'rejected-by-design');
  assert.equal(result.reasonCode, 'git-index-contention');
  assert.equal(result.queued, false);
  assert.equal(readFileSync(path.join(cwd, 'f0.txt'), 'utf8'), 'seed\n');
  rmSync(path.join(cwd, '.git/index.lock'));
  assert.equal(write(cwd, proposal(cwd, 'f0.txt', 'after-contention')).decision, 'accepted');
}
async function cli(cwd: string, p: PatchProposal, code: string, scope = 'f0.txt', reason: string | null = null) {
  writeFileSync(path.join(cwd, 'proposal.json'), JSON.stringify(p));
  const result = await runBroker(['steward', 'apply-live', '--cwd', cwd, '--proposal-file', 'proposal.json', '--scope-file', scope]);
  assert.equal(result.messages[0]?.code, `ATM_BROKER_LIVE_WRITE_${code}`);
  if (code === 'KIT_ERROR') assert.equal(result.messages[0]?.level, 'error');
  const evidence = result.evidence as { liveWrites: { reasonCode: string | null }[] };
  assert.equal(evidence.liveWrites[0]?.reasonCode, reason);
}
async function cliLabels() {
  const cwd = repo();
  const stale = proposal(cwd, 'f0.txt', 'stale', 'other');
  await cli(cwd, proposal(cwd), 'APPLIED');
  await cli(cwd, { ...stale, actorId: 'other' }, 'QUEUED', 'f0.txt', 'overlapping-write-queued');
  const p = proposal(cwd, 'f0.txt', 'bad');
  await cli(cwd, { ...p, patch: '@@ -1 +1 @@\n-absent\n+x\n' }, 'REJECTED', 'f0.txt', 'patch-context-mismatch');
  await cli(cwd, p, 'REJECTED', 'other.txt', 'outside-scope');
  await cli(cwd, proposal(cwd, 'missing.txt'), 'REJECTED', 'missing.txt', 'target-missing');
  const hookRepo = repo();
  writeFileSync(path.join(hookRepo, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await cli(hookRepo, proposal(hookRepo), 'KIT_ERROR', 'f0.txt', 'live-write-commit-failed');
  assert.equal(readFileSync(path.join(hookRepo, 'f0.txt'), 'utf8'), 'seed\n');
  assert.equal(git(hookRepo, ['diff', '--cached']), '');
  const overlapRepo = repo();
  write(overlapRepo, { ...proposal(overlapRepo, 'f0.txt', 'anchor'), patch: '@@ -1 +1,2 @@\n seed\n+tail\n', actorId: 'b' });
  write(overlapRepo, { ...proposal(overlapRepo, 'f0.txt', 'other'), patch: '@@ -1 +1 @@\n-seed\n+changed\n', actorId: 'a' });
  await cli(overlapRepo, { ...proposal(overlapRepo, 'f0.txt', 'overlap'), patch: '@@ -1 +1 @@\n-changed\n+overwrite\n', actorId: 'b' }, 'CROSS_SESSION_OVERLAP', 'f0.txt', 'cross-session-overlap');
}
