import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readFrameworkVersion, relativePathFrom } from '../shared.ts';
import { cleanForbiddenAdopterScratch, createEmptyScratchGuard } from './scratch.ts';
import type { InternalReleaseSyncOptions, ScratchGuardReport, SyncTargetReport } from './types.ts';
import { runNodeAtm, sha256File, sha256Text } from './support.ts';

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

  const verification = input.options.verify && !input.options.dryRun
    ? [
      runNodeAtm(repoPath, ['doctor', '--json']),
      runNodeAtm(repoPath, ['framework-mode', 'status', '--json']),
      runNodeAtm(repoPath, ['tasks', 'audit', '--json'])
    ]
    : [];
  const verificationOk = verification.every((run) => run.ok);
  return {
    repo: repoPath,
    repoName,
    skipped: false,
    skipReason: null,
    ok: input.options.allowVerifyFailure ? true : verificationOk,
    runnerPath: relativePathFrom(repoPath, runnerPath),
    metadataPath: relativePathFrom(repoPath, metadataPath),
    previousSha256,
    newSha256: input.options.dryRun ? input.sourceSha256 : sha256File(runnerPath),
    backupPath: backupPath ? relativePathFrom(repoPath, backupPath) : null,
    verification,
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
    warnings: [reason],
    scratchGuard
  };
}
