import { existsSync } from 'node:fs';
import path from 'node:path';
import { assertRunnerSyncAdmission, inspectRunnerSyncAdmission } from '../framework-development/runner-sync-admission.ts';
import { CliError } from '../shared.ts';
import { defaultOnefileRunnerPath } from './constants.ts';
import type { ReleasePublicationReadiness, ReleasePublicationReceipt } from './types.ts';
import {
  normalizeActiveCaptains,
  normalizeOptionalText,
  normalizePaths,
  readActiveReleaseCaptainsFromEnv,
  readGitDirtyFiles,
  readGitScalar,
  runCommand,
  sha256File
} from './support.ts';

export function inspectReleasePublicationReadiness(input: {
  readonly cwd: string;
  readonly stewardActorId: string;
  readonly sealedSourceCommit?: string | null;
  readonly artifactPath?: string | null;
  readonly artifactSha256?: string | null;
  readonly publicationReceipt?: string | null;
  readonly dirtyFiles?: readonly string[] | null;
  readonly activeCaptains?: readonly string[] | null;
  readonly ownershipAgreement?: string | null;
}): ReleasePublicationReadiness {
  const dirtyFiles = normalizePaths(input.dirtyFiles ?? readGitDirtyFiles(input.cwd));
  const sealedSourceCommit = normalizeOptionalText(input.sealedSourceCommit);
  const artifactSha256 = normalizeOptionalText(input.artifactSha256);
  const publicationReceipt = normalizeOptionalText(input.publicationReceipt);
  const activeCaptains = normalizeActiveCaptains(input.activeCaptains ?? []);
  const foreignCaptains = activeCaptains.filter((captain) => captain !== input.stewardActorId);
  const agreement = normalizeOptionalText(input.ownershipAgreement);
  const sealedSourceStateOk = dirtyFiles.length === 0 && Boolean(sealedSourceCommit);
  const ownershipOk = foreignCaptains.length === 0 || Boolean(agreement);
  const ok = sealedSourceStateOk && ownershipOk && Boolean(artifactSha256) && Boolean(publicationReceipt);
  return {
    schemaId: 'atm.releasePublicationReadiness.v1',
    ok,
    stewardActorId: input.stewardActorId,
    sealedSourceCommit,
    generatedArtifactDigest: artifactSha256,
    publicationReceipt,
    dirtyFiles,
    sealedSourceState: {
      ok: sealedSourceStateOk,
      reason: sealedSourceCommit
        ? dirtyFiles.length === 0
          ? null
          : 'publication validation requires a sealed source state; commit or stash dirty files before runner sync'
        : 'sealed source commit is required'
    },
    ownership: {
      ok: ownershipOk,
      activeCaptains,
      agreement,
      reason: ownershipOk ? null : 'concurrent runner-sync captains must agree on release artifact ownership first'
    },
    requiredCommand: ok
      ? null
      : 'seal source commit, record one release steward, artifact digest, and publication receipt before internal-release sync'
  };
}

export function assertReleasePublicationReadiness(report: ReleasePublicationReadiness): void {
  if (report.ok) return;
  const error = new Error(report.requiredCommand ?? 'Release publication readiness failed.');
  Object.assign(error, {
    code: report.sealedSourceState.ok ? 'ATM_RELEASE_PUBLICATION_OWNERSHIP_BLOCKED' : 'ATM_RELEASE_PUBLICATION_SEALED_SOURCE_REQUIRED',
    details: report
  });
  throw error;
}

export function createReleasePublicationReceipt(input: {
  readonly stewardActorId: string;
  readonly sealedSourceCommit: string | null;
  readonly artifactPath: string;
  readonly artifactSha256: string;
  readonly publicationReceipt: string;
  readonly generatedAt?: string;
}): ReleasePublicationReceipt {
  const sealedSourceCommit = normalizeOptionalText(input.sealedSourceCommit);
  if (!sealedSourceCommit) {
    throw new CliError('ATM_RELEASE_PUBLICATION_SOURCE_COMMIT_REQUIRED', 'Release publication receipt requires a sealed source commit.', { exitCode: 1 });
  }
  if (!input.artifactSha256.trim()) {
    throw new CliError('ATM_RELEASE_PUBLICATION_ARTIFACT_DIGEST_REQUIRED', 'Release publication receipt requires the generated artifact digest.', { exitCode: 1 });
  }
  return {
    schemaId: 'atm.releasePublicationReceipt.v1',
    stewardActorId: input.stewardActorId,
    sealedSourceCommit,
    artifactPath: input.artifactPath,
    artifactSha256: input.artifactSha256,
    publicationReceipt: input.publicationReceipt,
    generatedAt: input.generatedAt ?? new Date().toISOString()
  };
}

export function runNpmBuildAfterAdmission(cwd: string) {
  const sourceCommit = readGitScalar(cwd, ['rev-parse', '--verify', 'HEAD']);
  const stewardActorId = process.env.ATM_ACTOR_ID?.trim()
    || process.env.AGENT_IDENTITY?.trim()
    || 'release-steward';
  assertRunnerSyncAdmission(inspectRunnerSyncAdmission({
    cwd,
    stewardActorId,
    sealedSourceSha: sourceCommit
  }));
  assertReleasePublicationReadiness(inspectReleasePublicationReadiness({
    cwd,
    stewardActorId,
    sealedSourceCommit: sourceCommit,
    artifactPath: defaultOnefileRunnerPath,
    artifactSha256: existsSync(path.join(cwd, defaultOnefileRunnerPath)) ? sha256File(path.join(cwd, defaultOnefileRunnerPath)) : null,
    publicationReceipt: '.atm/history/reports/internal-release-sync/<run-id>/publication-receipt.json',
    activeCaptains: readActiveReleaseCaptainsFromEnv(stewardActorId),
    ownershipAgreement: process.env.ATM_RELEASE_ARTIFACT_OWNER_AGREEMENT ?? null
  }));
  if (process.platform === 'win32') {
    return runCommand(cwd, 'cmd.exe', ['/c', 'npm', 'run', 'build']);
  }
  return runCommand(cwd, 'npm', ['run', 'build']);
}
