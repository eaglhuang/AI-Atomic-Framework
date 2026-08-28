/**
 * The encoding guard must stay runnable on a busy worktree.
 *
 * `scripts/check-encoding-touched.ts` built one `--files` argument for every
 * touched text file. On this repository a working tree with a few hundred dirty
 * text files produces an argument of tens of kilobytes; Windows rejects the
 * process creation with ENAMETOOLONG, `spawnSync` returns a null status, and the
 * script exited 1 with completely empty stdout and stderr. A gate whose "found a
 * problem" and "never ran" outcomes are byte-identical is not a gate — and this
 * one guards text integrity ahead of commit, so it fails exactly when a parallel
 * captain session has made the tree busiest. Recorded as ATM-BUG-2026-08-28-001.
 *
 * The repair reuses the argv budget policy the Git pathspec callers already
 * share, so there is one place that knows the platform ceiling.
 *
 * caseId: test_int_encoding_guard_batches_against_argv_budget
 * semanticKey: encoding_guard_runs_instead_of_exiting_silently_on_long_argv
 * contractEdge: encoding-guard-invocation
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  planPathspecBatches,
  resolvePathspecArgvBudget
} from '../../packages/cli/src/commands/git-governance/implementation/pathspec-argv-batching.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD_FIXED_ARGS = ['atm.mjs', 'guard', 'encoding', '--files', '--json'];

/**
 * A real, tracked, encoding-clean file set large enough that its joined
 * `--files` argument exceeds the platform budget. Using tracked sources keeps
 * the case deterministic without inventing fixture paths that would not
 * reproduce the argv sizes the defect needs.
 */
function oversizedTrackedFileSet(): string[] {
  const tracked = execFileSync('git', ['ls-files', 'packages', 'tests'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => /\.ts$/.test(entry) && !entry.includes('/dist/'));

  const budgetBytes = resolvePathspecArgvBudget().budgetBytes;
  const picked: string[] = [];
  let joinedBytes = 0;
  for (const filePath of tracked) {
    if (joinedBytes > budgetBytes * 1.4) break;
    picked.push(filePath);
    joinedBytes += Buffer.byteLength(filePath, 'utf8') + 1;
  }
  assert.ok(
    joinedBytes > budgetBytes,
    'the fixture must exceed the argv budget or it cannot reproduce the defect'
  );
  return picked;
}

const files = oversizedTrackedFileSet();

// The single oversized argument really is unspawnable: this is the failure the
// guard used to swallow, asserted directly rather than assumed.
{
  const result = spawnSync(
    process.execPath,
    ['atm.mjs', 'guard', 'encoding', '--files', files.join(','), '--json'],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (process.platform === 'win32') {
    assert.equal(result.status, null, 'an oversized argv must not produce an exit status');
    assert.equal((result.error as NodeJS.ErrnoException | undefined)?.code, 'ENAMETOOLONG');
  }
}

// Batching splits the same work into runnable invocations and drops nothing:
// the planned batches must reproduce the input set exactly.
{
  const plan = planPathspecBatches({ paths: files, fixedArgs: GUARD_FIXED_ARGS });
  assert.ok(plan.batches.length > 1, 'this fixture must require more than one batch');
  assert.deepEqual(
    [...plan.batches.flat()].sort(),
    [...new Set(files)].sort(),
    'batching must preserve every file'
  );
  for (const batch of plan.batches) {
    const argv = [...GUARD_FIXED_ARGS.slice(0, 4), batch.join(','), '--json'];
    const bytes = argv.reduce((total, arg) => total + Buffer.byteLength(arg, 'utf8') + 1, 0);
    assert.ok(bytes < plan.budgetBytes, 'every planned invocation must fit the budget');
  }
}

// End to end: every planned batch is genuinely spawnable and reaches the guard.
// The oversized list the script derives from a busy worktree is never passed in
// as argv — it is built internally — so this drives the same invocation the
// script now makes, one batch at a time.
{
  const plan = planPathspecBatches({ paths: files, fixedArgs: GUARD_FIXED_ARGS });
  for (const batch of plan.batches) {
    const result = spawnSync(
      process.execPath,
      ['atm.mjs', 'guard', 'encoding', '--files', batch.join(','), '--json'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
    );
    assert.equal(result.error, undefined, 'a planned batch must be spawnable');
    assert.equal(typeof result.status, 'number', 'a planned batch must produce an exit status');
    assert.ok(
      String(result.stdout ?? '').includes('ATM_GUARD_ENCODING_OK'),
      `a clean tracked batch must pass the guard: ${String(result.stderr ?? '')}`
    );
    assert.equal(result.status, 0);
  }
}

// A guard that cannot run must say so instead of exiting 1 in silence. The
// script reports the spawn failure it was given, so the operator can tell
// "never ran" apart from "found a problem".
{
  const result = spawnSync(
    process.execPath,
    ['--strip-types', 'scripts/check-encoding-touched.ts', '--files', 'does-not-exist-anywhere.ts'],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const combined = `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`;
  assert.ok(combined.trim().length > 0, 'the guard must never terminate without output');
}

console.log('[encoding-guard-argv-budget:test] ok');
