import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runInternalRelease, runInternalReleaseSync } from '../packages/cli/src/commands/internal-release.ts';
import { findVerificationRegressions } from '../packages/cli/src/commands/internal-release/target-sync.ts';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string): never {
  console.error(`[internal-release-sync:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256File(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function runGit(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert(result.status === 0 && !result.error, `git ${args.join(' ')} must succeed in fixture repo`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-internal-release-'));
try {
  const fixtureFrameworkRoot = path.join(tempRoot, 'framework-root');
  mkdirSync(fixtureFrameworkRoot, { recursive: true });
  writeJson(path.join(fixtureFrameworkRoot, 'package.json'), { version: '0.1.0' });
  runGit(fixtureFrameworkRoot, ['init']);
  runGit(fixtureFrameworkRoot, ['config', 'user.email', 'atm-validator@example.invalid']);
  runGit(fixtureFrameworkRoot, ['config', 'user.name', 'ATM Validator']);
  runGit(fixtureFrameworkRoot, ['add', 'package.json']);
  runGit(fixtureFrameworkRoot, ['commit', '-m', 'fixture framework root']);

  const sourceRunner = path.join(tempRoot, 'source-atm.mjs');
  writeFileSync(sourceRunner, '#!/usr/bin/env node\nconsole.log("atm internal release fixture");\n', 'utf8');
  const sourceHash = sha256File(sourceRunner);

  const targetA = path.join(tempRoot, 'host-a');
  const targetB = path.join(tempRoot, 'host-b');
  const targetC = path.join(tempRoot, 'host-c');
  for (const repo of [targetA, targetB, targetC]) {
    mkdirSync(repo, { recursive: true });
    writeJson(path.join(repo, '.atm', 'config.json'), { schemaVersion: 'atm.config.v0.1' });
  }
  writeFileSync(path.join(targetA, 'atm.mjs'), 'old runner\n', 'utf8');
  mkdirSync(path.join(targetA, 'scratch', 'atm-build-repo'), { recursive: true });
  mkdirSync(path.join(targetA, 'scratch', 'atm-upstream-patch'), { recursive: true });
  writeFileSync(path.join(targetA, 'scratch', 'atm-build-repo', 'stale-atm.mjs'), 'stale build scratch\n', 'utf8');
  writeFileSync(path.join(targetA, 'scratch', 'atm-upstream-patch', 'doctor.ts'), 'stale patch scratch\n', 'utf8');
  const previousHash = sha256File(path.join(targetA, 'atm.mjs'));

  const report = runInternalReleaseSync({
    cwd: fixtureFrameworkRoot,
    repos: [targetA, targetB],
    skips: ['host-b'],
    build: false,
    dryRun: false,
    verify: false,
    allowVerifyFailure: false,
    source: sourceRunner,
    keepTemp: false,
    commit: false
  });
  assert(report.ok === true, 'sync report must be ok when copied target succeeds and second target is skipped');
  assert(report.sourceSha256 === sourceHash, 'sync report must include source runner hash');
  const hostA = report.targets.find((target) => target.repoName === 'host-a');
  const hostB = report.targets.find((target) => target.repoName === 'host-b');
  assert(hostA?.ok === true && hostA.skipped === false, 'host-a must sync');
  if (!hostA) fail('host-a report must exist');
  assert(hostA.previousSha256 === previousHash, 'host-a must report previous runner hash');
  assert(hostA.newSha256 === sourceHash, 'host-a must report new runner hash');
  assert(Boolean(hostA.backupPath), 'host-a must keep a previous runner backup');
  assert(hostA.scratchGuard.present.length === 2, 'host-a must detect known ATM scratch directories');
  assert(hostA.scratchGuard.removed.length === 2, 'host-a must clean known ATM scratch directories by default');
  assert(hostA.scratchGuard.fileCount === 2, 'host-a scratch guard must report cleaned file count');
  assert(!existsSync(path.join(targetA, 'scratch', 'atm-build-repo')), 'host-a sync must remove stale atm-build-repo scratch');
  assert(!existsSync(path.join(targetA, 'scratch', 'atm-upstream-patch')), 'host-a sync must remove stale atm-upstream-patch scratch');
  assert(readFileSync(path.join(targetA, 'atm.mjs'), 'utf8') === readFileSync(sourceRunner, 'utf8'), 'host-a atm.mjs must be replaced by source runner');
  assert(JSON.parse(readFileSync(path.join(targetA, '.atm', 'runtime', 'pinned-runner.json'), 'utf8')).sourceKind === 'internal-build-sync', 'host-a pinned runner metadata must record internal-build-sync');
  assert(hostB?.skipped === true && hostB.skipReason?.includes('--skip'), 'host-b must be skipped by basename');
  assert(!existsSync(path.join(targetB, 'atm.mjs')), 'skipped host-b must not be mutated');

  const dryRun = runInternalReleaseSync({
    cwd: fixtureFrameworkRoot,
    repos: [targetC],
    skips: [],
    build: false,
    dryRun: true,
    verify: false,
    allowVerifyFailure: false,
    source: sourceRunner,
    keepTemp: false,
    commit: false
  });
  assert(dryRun.ok === true, 'dry-run must be ok');
  assert(dryRun.targets[0]?.newSha256 === sourceHash, 'dry-run target must show planned source hash');
  assert(!existsSync(path.join(targetC, 'atm.mjs')), 'dry-run must not write target atm.mjs');

  const cliResult = runInternalRelease(['sync', '--cwd', fixtureFrameworkRoot, '--repo', targetC, '--source', sourceRunner, '--no-build', '--dry-run', '--no-verify']);
  assert(cliResult.ok === true, 'internal-release sync CLI runner must support dry-run no-build no-verify');

  // Regression-only verification: a check failing before and after the swap
  // is pre-existing; only a check that passed before and fails after blocks.
  const run = (command: string, ok: boolean) => ({ command, cwd: '.', exitCode: ok ? 0 : 1, stdoutSha256: '', stderrSha256: '', ok });
  assert(findVerificationRegressions([run('doctor', false)], [run('doctor', false)]).length === 0, 'pre-existing failure must not be a regression');
  assert(findVerificationRegressions([run('doctor', true)], [run('doctor', false)])[0] === 'doctor', 'pass-to-fail must be a regression');
  assert(findVerificationRegressions([], [run('doctor', false)])[0] === 'doctor', 'without a baseline every failure counts');

  // --commit: commits only the runner sync paths and leaves other staged work alone.
  const targetD = path.join(tempRoot, 'host-d');
  mkdirSync(targetD, { recursive: true });
  writeJson(path.join(targetD, '.atm', 'config.json'), { schemaVersion: 'atm.config.v0.1' });
  writeFileSync(path.join(targetD, 'atm.mjs'), 'process.exit(1);\n', 'utf8');
  writeJson(path.join(targetD, '.atm', 'runtime', 'pinned-runner.json'), { status: 'old' });
  runGit(targetD, ['init']);
  runGit(targetD, ['config', 'user.email', 'atm-validator@example.invalid']);
  runGit(targetD, ['config', 'user.name', 'ATM Validator']);
  runGit(targetD, ['add', '.']);
  runGit(targetD, ['commit', '-m', 'host-d baseline']);
  writeFileSync(path.join(targetD, 'other-work.txt'), 'staged by someone else\n', 'utf8');
  runGit(targetD, ['add', 'other-work.txt']);
  const committed = runInternalReleaseSync({
    cwd: fixtureFrameworkRoot,
    repos: [targetD],
    skips: [],
    build: false,
    dryRun: false,
    verify: true,
    allowVerifyFailure: false,
    source: sourceRunner,
    keepTemp: false,
    commit: true
  });
  const hostD = committed.targets[0];
  assert(committed.ok === true && hostD?.regressions.length === 0, 'old-runner failures that the new runner fixes must not block the sync');
  assert(hostD?.baselineVerification.length === 3 && hostD.baselineVerification.every((entry) => !entry.ok), 'baseline must run every check with the previous runner');
  assert(hostD?.commit?.ok === true && Boolean(hostD.commit.commitSha), 'runner sync must be committed');
  const committedFiles = spawnSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: targetD, encoding: 'utf8' }).stdout.trim().split(/\r?\n/).sort();
  assert(committedFiles.join(',') === '.atm/runtime/pinned-runner.json,atm.mjs', 'commit must contain only the runner sync paths');
  const stillStaged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: targetD, encoding: 'utf8' }).stdout.trim();
  assert(stillStaged === 'other-work.txt', 'unrelated staged work must stay staged and out of the commit');

  if (!process.exitCode) {
    console.log(`[internal-release-sync:${mode}] ok (sync, skip, dry-run, backup, metadata, regression-only verify, and commit verified)`);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
