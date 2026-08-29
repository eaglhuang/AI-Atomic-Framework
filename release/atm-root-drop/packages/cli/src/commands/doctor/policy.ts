import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.ts';
import type { DoctorCheck, DoctorOptions } from './types.ts';

interface DoctorRepositoryIdentity {
  readonly isFrameworkRepo: boolean;
  readonly score: number;
  readonly root: string;
  readonly name: string | null;
  readonly signals: readonly string[];
}

/**
 * A root-drop release intentionally carries the framework package name and
 * source topology, but it is an adopter-facing portable bundle.  Doctor must
 * therefore apply host policy to an explicit root-drop manifest rather than
 * requiring every development-workspace distribution artifact.
 */
export function resolveDoctorRepositoryIdentity(root: string, identity: DoctorRepositoryIdentity): DoctorRepositoryIdentity {
  const manifestPath = path.join(root, 'release-manifest.json');
  if (!existsSync(manifestPath)) {
    return identity;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { schemaVersion?: unknown };
    if (typeof manifest.schemaVersion !== 'string' || !manifest.schemaVersion.startsWith('atm.rootDropRelease.')) {
      return identity;
    }
    return {
      ...identity,
      isFrameworkRepo: false,
      signals: [...identity.signals, 'release-manifest:atm.rootDropRelease']
    };
  } catch {
    return identity;
  }
}

export function resolveDoctorPolicy(options: DoctorOptions) {
  const supportedProfiles = new Set(['dependency-pr']);
  const supportedSkipChecks = new Set(['git-head-evidence']);
  const ciProfile = typeof options.ciProfile === 'string' && options.ciProfile.trim()
    ? options.ciProfile.trim()
    : null;
  if (ciProfile && !supportedProfiles.has(ciProfile)) {
    throw new CliError('ATM_CLI_USAGE', `doctor does not support CI profile ${ciProfile}`, {
      exitCode: 2,
      details: {
        supportedProfiles: [...supportedProfiles]
      }
    });
  }

  const skipChecks = new Set<string>();
  for (const checkName of options.skipChecks ?? []) {
    const normalized = String(checkName).trim();
    if (!normalized) {
      continue;
    }
    if (!supportedSkipChecks.has(normalized)) {
      throw new CliError('ATM_CLI_USAGE', `doctor does not support skipping check ${normalized}`, {
        exitCode: 2,
        details: {
          supportedSkipChecks: [...supportedSkipChecks]
        }
      });
    }
    skipChecks.add(normalized);
  }
  if (ciProfile === 'dependency-pr') {
    skipChecks.add('git-head-evidence');
  }

  return {
    ciProfile,
    skipChecks: [...skipChecks],
    skipReason: ciProfile === 'dependency-pr'
      ? 'Dependency automation PRs do not produce ATM git-head governance evidence, but other doctor checks still run.'
      : skipChecks.size > 0
        ? 'Explicit doctor --skip-check policy.'
        : null
  };
}

export function applyDoctorPolicyToCheck(check: DoctorCheck, policy: ReturnType<typeof resolveDoctorPolicy>): DoctorCheck {
  if (!policy.skipChecks.includes(check.name)) {
    return check;
  }
  const originalDetails = check.details;
  const originalStatus = (originalDetails && typeof originalDetails === 'object' && 'status' in originalDetails)
    ? (originalDetails as Record<string, unknown>).status
    : null;
  return {
    ...check,
    ok: true,
    details: {
      status: 'skipped',
      skippedBy: policy.ciProfile ? 'ci-profile' : 'skip-check',
      ciProfile: policy.ciProfile,
      reason: policy.skipReason,
      originalStatus: originalStatus ?? null,
      originalOk: check.ok === true,
      originalDetails: originalDetails ?? null
    }
  };
}

export function downgradeAdopterGitHeadEvidenceCheck(check: DoctorCheck, repoIdentity: { isFrameworkRepo: boolean }): DoctorCheck {
  const details = check.details;
  const status = (details && typeof details === 'object' && 'status' in details)
    ? (details as Record<string, unknown>).status
    : null;
  if (check.ok || status !== 'missing') {
    return check;
  }
  return {
    ...check,
    ok: true,
    details: {
      ...(details as Record<string, unknown>),
      enforcement: 'warning',
      downgradedToWarning: true,
      perCriticalCommitEnforcement: 'disabled',
      strictBoundary: 'same-commit-provenance-and-closeout-evidence'
    }
  };
}
