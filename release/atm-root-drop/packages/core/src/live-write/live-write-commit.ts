import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashContent } from '../broker/adapters/cas.ts';
import { defaultStewardCommitLockRoot } from '../broker/steward-commit-guard.ts';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock } from '../broker/steward-kernel-lock.ts';
import { diffCommittedBlocks, gitFileAt } from './cross-session-overlap.ts';
import { appendJournal, readJournal, RecoveryRequiredError, type CommittedEntry, type IntentEntry } from './live-write-journal-store.ts';

export class GitIndexContentionError extends Error {}

function withCommitLock<T>(cwd: string, action: () => T): T {
  // Caller already holds the per-file lock. Never acquire in the reverse order.
  const lock = path.join(defaultStewardCommitLockRoot(cwd), 'repo-commit');
  acquireKernelAdvisoryLock(lock, 30_000, 5, 'repo commit');
  try { return action(); } finally { releaseKernelAdvisoryLock(lock); }
}
function git(cwd: string, args: string[]) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}
export function proposalCommitSha(cwd: string, proposalId: string): string | null {
  const find = (count: number) => {
    const log = git(cwd, ['log', `-${count}`, '--format=%H%x00%s']);
    if (log.status !== 0) return null;
    for (const line of log.stdout.trimEnd().split('\n')) {
      const [sha, subject] = line.split('\0');
      if (subject === `steward live write ${proposalId}` && sha) return sha;
    }
    return null;
  };
  return find(1) ?? find(50);
}
function gitCommit(cwd: string, file: string, proposalId: string): string {
  // Foreign Git processes do not take our repo lock: five attempts, 200ms
  // total backoff (20+40+60+80ms). Contention exhaustion is a safe rejection.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const add = git(cwd, ['add', '--', file]);
    const result = add.status === 0 ? git(cwd, [
      '-c', 'user.name=atm-steward', '-c', 'user.email=atm-steward@localhost',
      '-c', 'commit.gpgsign=false', 'commit', '-m', `steward live write ${proposalId}`, '--', file
    ]) : add;
    if (result.status === 0) {
      const sha = proposalCommitSha(cwd, proposalId);
      if (!sha) throw new RecoveryRequiredError(`recovery-required: commit identity missing for ${proposalId}`);
      return sha;
    }
    const detail = result.stderr || result.stdout || 'git commit failed';
    if (!/index\.lock/.test(detail)) throw new Error(detail);
    if (attempt === 4) throw new GitIndexContentionError(detail);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
  }
  throw new GitIndexContentionError('git index contention');
}
function replaceFileAtomically(target: string, content: string): void {
  const temporary = `${target}.${randomUUID()}.atm-tmp`;
  try {
    writeFileSync(temporary, content, { mode: statSync(target).mode & 0o777 });
    renameSync(temporary, target);
  } finally { rmSync(temporary, { force: true }); }
}
export function commitLiveWrite(cwd: string, target: string, before: string, after: string, entry: CommittedEntry): string {
  const backup = path.join('.atm/runtime/live-write-backups', `${randomUUID()}.bak`);
  const backupPath = path.join(cwd, backup);
  mkdirSync(path.dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, before);
  appendJournal(cwd, { ...entry, kind: 'intent', backup });
  return withCommitLock(cwd, () => {
    let committed = false;
    try {
      replaceFileAtomically(target, after);
      const sha = gitCommit(cwd, entry.file, entry.proposalId);
      committed = true;
      appendJournal(cwd, { ...entry, kind: 'committed', commitSha: sha });
      rmSync(backupPath, { force: true });
      return sha;
    } catch (error) {
      if (!committed && !proposalCommitSha(cwd, entry.proposalId)) {
        replaceFileAtomically(target, before);
        // Roll back staging while still holding the repo lock. Foreign index
        // locks may prevent reset; keep the intent as the recovery receipt.
        const reset = git(cwd, ['reset', '-q', 'HEAD', '--', entry.file]);
        if (reset.status === 0) {
          appendJournal(cwd, { kind: 'abandoned', proposalId: entry.proposalId });
          rmSync(backupPath, { force: true });
        }
      }
      throw error;
    }
  });
}
/** Recover only bytes whose identity is proven; never overwrite an unknown edit. */
export function reconcileLiveWrites(cwd: string, file: string): void {
  const records = readJournal(cwd);
  for (let index = 0; index < records.length; index += 1) {
    const intent = records[index]!;
    if (intent.kind !== 'intent' || intent.file !== file) continue;
    if (records.slice(index + 1).some((entry) => entry.proposalId === intent.proposalId && (entry.kind === undefined || entry.kind === 'committed' || entry.kind === 'abandoned'))) continue;
    reconcileIntent(cwd, intent);
  }
}
function reconcileIntent(cwd: string, intent: IntentEntry): void {
  const target = path.join(cwd, intent.file);
  const current = readFileSync(target, 'utf8');
  const hash = hashContent(current);
  const bare = (value: string) => value.replace(/^sha256:/, '');
  if (bare(hash) === bare(intent.baseHash)) {
    withCommitLock(cwd, () => {
      const reset = git(cwd, ['reset', '-q', 'HEAD', '--', intent.file]);
      if (reset.status !== 0) throw new GitIndexContentionError(reset.stderr || 'git index contention during recovery');
      appendJournal(cwd, { kind: 'abandoned', proposalId: intent.proposalId });
    });
  } else if (bare(hash) === bare(intent.afterHash)) {
    withCommitLock(cwd, () => {
      let before: string;
      try { before = readFileSync(path.join(cwd, intent.backup), 'utf8'); } catch {
        throw new RecoveryRequiredError('recovery-required: intent backup unavailable');
      }
      if (bare(hashContent(before)) !== bare(intent.baseHash)) throw new RecoveryRequiredError('recovery-required: backup hash mismatch');
      let sha = proposalCommitSha(cwd, intent.proposalId);
      if (sha && gitFileAt(cwd, sha, intent.file) !== current) throw new RecoveryRequiredError('recovery-required: committed bytes mismatch');
      if (!sha) {
        if (gitFileAt(cwd, 'HEAD', intent.file) === current) throw new RecoveryRequiredError('recovery-required: change committed under unknown proposal');
        sha = gitCommit(cwd, intent.file, intent.proposalId);
      }
      const { backup: _backup, kind: _kind, ...entry } = intent;
      const blocks = intent.blocks ?? diffCommittedBlocks(before, current);
      appendJournal(cwd, { ...entry, kind: 'committed', blocks, commitSha: sha });
    });
  } else {
    throw new RecoveryRequiredError(`recovery-required: ${intent.file} matches neither intent hash`);
  }
  rmSync(path.join(cwd, intent.backup), { force: true });
}
