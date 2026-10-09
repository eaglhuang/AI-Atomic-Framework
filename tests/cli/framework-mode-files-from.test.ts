/**
 * framework-mode claim and the framework-development guard must accept the same
 * declared file set from a newline-separated file. A single `--files` CSV of a
 * few thousand long paths exceeds Linux MAX_ARG_STRLEN (~128KB) and makes the
 * Dogfood preflight exit 126 before it can claim anything.
 *
 * caseId: test_int_framework_mode_files_from_long_paths
 * semanticKey: framework_claim_file_list_does_not_use_one_argv_string
 * contractEdge: framework-mode-claim
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { declaredFilesFromCommaSeparated } from '../../packages/cli/src/commands/framework-development/files-from.ts';
import { runFrameworkMode } from '../../packages/cli/src/commands/framework-development.ts';
import { runGuard } from '../../packages/cli/src/commands/guard.ts';

delete process.env.ATM_ACTOR_ID;
delete process.env.ATM_TASK_ID;
delete process.env.ATM_LANE_SESSION_ID;

const ARG_STRLEN_LIMIT = 128 * 1024;

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitRepo(): string {
  const root = tempDir('atm-files-from-repo-');
  execFileSync('git', ['init', '--quiet', root]);
  return root;
}

function changedFiles(result: { evidence?: unknown }): readonly string[] {
  const evidence = result.evidence as { report?: { changedFiles?: readonly string[] } };
  const files = evidence.report?.changedFiles;
  assert.ok(Array.isArray(files), 'framework report must include changedFiles');
  return files;
}

function expectedOrder(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

{
  const csv = 'a.ts, dir\\b.ts ,./c.ts,,';
  const lines = 'a.ts\n dir\\b.ts \n./c.ts\n\n';
  const normalized = ['a.ts', 'dir/b.ts', 'c.ts'];
  assert.deepEqual(declaredFilesFromCommaSeparated(csv), normalized);
  const dir = tempDir('atm-files-from-equiv-');
  const listPath = path.join(dir, 'files.txt');
  writeFileSync(listPath, lines, 'utf8');
  const root = gitRepo();
  try {
    const fromCsv = await runFrameworkMode(['status', '--cwd', root, '--files', csv]);
    const fromFile = await runFrameworkMode(['status', '--cwd', root, '--files-from', listPath]);
    assert.deepEqual(changedFiles(fromFile), changedFiles(fromCsv));
    assert.deepEqual(changedFiles(fromFile), expectedOrder(normalized));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const dir = tempDir('atm-files-from-comma-');
  const listPath = path.join(dir, 'files.txt');
  writeFileSync(listPath, 'keep,comma.ts\nplain.ts\n', 'utf8');
  const root = gitRepo();
  try {
    const fromFile = await runFrameworkMode(['status', '--cwd', root, '--files-from', listPath]);
    assert.deepEqual(changedFiles(fromFile), ['keep,comma.ts', 'plain.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = gitRepo();
  try {
    await assert.rejects(
      async () => runFrameworkMode(['status', '--cwd', root, '--files-from', path.join(root, 'missing-list.txt')]),
      (error: unknown) => Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'ATM_CLI_USAGE')
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const count = 3000;
  const stem = 'research/paper-v2/benchmark-trials/2026-10-09-hist-pilot/raw/runs';
  const paths = Array.from({ length: count }, (_, index) => {
    const id = String(index).padStart(5, '0');
    return `${stem}/django_pair_${id}__steward__s0/artifacts/steward/cb-django_db_backends_postgresql_features.py-w${index % 4}-${id}.json`;
  });
  const csvBytes = Buffer.byteLength(paths.join(','), 'utf8');
  assert.ok(csvBytes > ARG_STRLEN_LIMIT, `fixture CSV must exceed the single-arg limit, got ${csvBytes}`);

  const dir = tempDir('atm-files-from-long-');
  const listPath = path.join(dir, 'files.txt');
  writeFileSync(listPath, `${paths.join('\n')}\n`, 'utf8');
  const root = gitRepo();
  try {
    const status = await runFrameworkMode(['status', '--cwd', root, '--files-from', listPath]);
    assert.deepEqual(changedFiles(status), expectedOrder(paths));

    const guard = runGuard(['framework-development', '--cwd', root, '--files-from', listPath]);
    assert.deepEqual(changedFiles(guard), expectedOrder(paths));

    const claim = await runFrameworkMode([
      'claim',
      '--cwd', root,
      '--actor', 'ci-files-from',
      '--files-from', listPath,
      '--reason', 'argv budget regression'
    ]);
    assert.equal(claim.ok, true);
    const lockDir = path.join(root, '.atm', 'runtime', 'locks');
    const lockNames = readdirSync(lockDir).filter((name) => name.endsWith('.lock.json'));
    assert.equal(lockNames.length, 1);
    const lock = JSON.parse(readFileSync(path.join(lockDir, lockNames[0]), 'utf8')) as { files?: string[] };
    assert.deepEqual(lock.files, expectedOrder(paths));
    assert.equal(lock.files?.length, count);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('[framework-mode-files-from.test] ok');
