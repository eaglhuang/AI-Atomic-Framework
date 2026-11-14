import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readFrameworkVersion, relativePathFrom } from '../shared.ts';
import { cleanForbiddenAdopterScratch, createEmptyScratchGuard } from './scratch.ts';
import { spawnSync } from 'node:child_process';
import type { CommandRunRecord, InternalReleaseSyncOptions, ScratchGuardReport, SyncTargetReport, TargetCommitReport } from './types.ts';
import { readGitScalar, runNodeAtm, sha256File, sha256Text } from './support.ts';
import { targetRunnerSyncPaths, targetVerificationCommands } from './constants.ts';

export function syncTarget(input: {
  readonly repo: string;
  readonly options: InternalReleaseSyncOptions;
  readonly sourceRunnerPath: string;
  readonly sourceSha256: string;
  readonly sourceCommit: string | null;
  readonly runId: string;
  readonly skipMatcher: (repoPath: string) => string | null;
}): SyncTargetReport {
  const repoPath = path.resolve(input.options.cwd, input.repo);
  const repoName = path.basename(repoPath);
  const skipReason = input.skipMatcher(repoPath);
  const runnerPath = path.join(repoPath, 'atm.mjs');
  const metadataPath = path.join(repoPath, '.atm', 'runtime', 'pinned-runner.json');
  const warnings: string[] = [];
  const emptyScratchGuard = createEmptyScratchGuard(input.options);
  if (skipReason) {
    return {
      repo: repoPath,
      repoName,
      skipped: true,
      skipReason,
      ok: true,
      runnerPath: relativePathFrom(repoPath, runnerPath),
      metadataPath: relativePathFrom(repoPath, metadataPath),
      previousSha256: null,
      newSha256: null,
      backupPath: null,
      verification: [],
      baselineVerification: [],
      regressions: [],
      commit: null,
      warnings,
      scratchGuard: emptyScratchGuard
    };
  }
  if (!existsSync(repoPath)) {
    return failedTarget(repoPath, runnerPath, metadataPath, 'target repo does not exist', emptyScratchGuard);
  }

  const scratchGuard = cleanForbiddenAdopterScratch(repoPath, input.options);
  if (scratchGuard.present.length > 0) {
    warnings.push(input.options.keepTemp
      ? 'known ATM scratch directories are present and were kept because --keep-temp was set'
      : input.options.dryRun
        ? 'known ATM scratch directories are present; dry-run reports them without cleanup'
        : 'known ATM scratch directories were removed from the target repo');
  }
  if (!scratchGuard.ok) {
    return failedTarget(repoPath, runnerPath, metadataPath, 'target ATM scratch cleanup failed', scratchGuard);
  }

  const previousSha256 = existsSync(runnerPath) ? sha256File(runnerPath) : null;
  const backupPath = previousSha256
    ? path.join(repoPath, '.atm', 'history', 'reports', 'internal-release-sync', input.runId, 'atm.mjs.previous')
    : null;
  if (!existsSync(path.join(repoPath, '.atm', 'config.json'))) {
    warnings.push('.atm/config.json is missing; target may not be bootstrapped');
  }

  const runChecks = input.options.verify && !input.options.dryRun;
  const baselineVerification = runChecks && previousSha256 ? runVerification(repoPath) : [];

  if (!input.options.dryRun) {
    if (backupPath) {
      mkdirSync(path.dirname(backupPath), { recursive: true });
      copyFileSync(runnerPath, backupPath);
    }
    copyFileSync(input.sourceRunnerPath, runnerPath);
    mkdirSync(path.dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, `${JSON.stringify({
      schemaVersion: 'atm.pinnedRunner.v0.1',
      runnerPath: 'atm.mjs',
      metadataPath: '.atm/runtime/pinned-runner.json',
      command: 'node atm.mjs next --json',
      status: previousSha256 ? 'replaced' : 'installed',
      sourceKind: 'internal-build-sync',
      sourcePath: input.sourceRunnerPath,
      sha256: input.sourceSha256,
      existingSha256: previousSha256,
      sizeBytes: statSync(input.sourceRunnerPath).size,
      frameworkVersion: readFrameworkVersion(input.options.cwd),
      sourceCommit: input.sourceCommit,
      generatedAt: new Date().toISOString()
    }, null, 2)}\n`, 'utf8');
  }

  const verification = runChecks ? runVerification(repoPath) : [];
  const regressions = findVerificationRegressions(baselineVerification, verification);
  const verificationOk = input.options.allowVerifyFailure || regressions.length === 0;
  if (baselineVerification.length > 0 && verification.some((run) => !run.ok) && regressions.length === 0) {
    warnings.push('some target checks fail with both the previous and the new runner; they are pre-existing and do not block this sync');
  }
  const commit = input.options.commit && !input.options.dryRun && verificationOk && previousSha256 !== input.sourceSha256
    ? commitRunnerSync(repoPath, readFrameworkVersion(input.options.cwd))
    : null;
  if (commit && !commit.ok) warnings.push(`runner sync commit failed: ${commit.detail ?? 'unknown error'}`);
  return {
    repo: repoPath,
    repoName,
    skipped: false,
    skipReason: null,
    ok: verificationOk && (commit?.ok ?? true),
    runnerPath: relativePathFrom(repoPath, runnerPath),
    metadataPath: relativePathFrom(repoPath, metadataPath),
    previousSha256,
    newSha256: input.options.dryRun ? input.sourceSha256 : sha256File(runnerPath),
    backupPath: backupPath ? relativePathFrom(repoPath, backupPath) : null,
    verification,
    baselineVerification,
    regressions,
    commit,
    warnings,
    scratchGuard
  };
}

function failedTarget(repoPath: string, runnerPath: string, metadataPath: string, reason: string, scratchGuard: ScratchGuardReport): SyncTargetReport {
  return {
    repo: repoPath,
    repoName: path.basename(repoPath),
    skipped: false,
    skipReason: null,
    ok: false,
    runnerPath: relativePathFrom(repoPath, runnerPath),
    metadataPath: relativePathFrom(repoPath, metadataPath),
    previousSha256: null,
    newSha256: null,
    backupPath: null,
    verification: [{
      command: 'internal target preflight',
      cwd: repoPath,
      exitCode: 1,
      stdoutSha256: sha256Text(reason),
      stderrSha256: sha256Text(''),
      ok: false
    }],
    baselineVerification: [],
    regressions: [],
    commit: null,
    warnings: [reason],
    scratchGuard
  };
}

function runVerification(repoPath: string): CommandRunRecord[] {
  return targetVerificationCommands.map((args) => runNodeAtm(repoPath, args));
}

/** A regression is a check that passed with the previous runner and fails with the new one. Without a baseline every failure counts. */
export function findVerificationRegressions(baseline: readonly CommandRunRecord[], current: readonly CommandRunRecord[]): string[] {
  const passedBefore = new Set(baseline.filter((run) => run.ok).map((run) => run.command));
  const hasBaseline = baseline.length > 0;
  return current.filter((run) => !run.ok && (!hasBaseline || passedBefore.has(run.command))).map((run) => run.command);
}

/**
 * Commit only the runner sync paths. `git commit --only` leaves whatever else
 * is staged in the target repository untouched and out of this commit.
 */
function commitRunnerSync(repoPath: string, frameworkVersion: string): TargetCommitReport {
  const paths = targetRunnerSyncPaths.filter((entry) => readGitScalar(repoPath, ['ls-files', '--', entry]) || existsSync(path.join(repoPath, entry)));
  const actor = process.env.ATM_ACTOR_ID?.trim() || process.env.AGENT_IDENTITY?.trim() || 'release-steward';
  const message = `chore(atm): sync ATM runner ${frameworkVersion}

ATM-Actor: ${actor}`;
  const result = spawnSync('git', ['commit', '--only', '-m', message, '--', ...paths], { cwd: repoPath, encoding: 'utf8' });
  const ok = !result.error && result.status === 0;
  const detail = ok ? null : [result.stderr, result.stdout, result.error?.message].filter(Boolean).join(String.fromCharCode(10)).trim().slice(-2000) || null;
  return { paths, commitSha: ok ? readGitScalar(repoPath, ['rev-parse', 'HEAD']) : null, exitCode: result.status ?? 1, ok, detail };
}
