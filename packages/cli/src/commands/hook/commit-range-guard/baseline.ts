import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runGit, runGitScalar } from '../git-index-diagnostics.ts';
import { normalizeOptionalText } from './support.ts';

export interface FrameworkCommitRangeBaseline {
  readonly schemaId: 'atm.frameworkCommitRangeBaseline.v1';
  readonly generatedAt: string;
  readonly name: string | null;
  readonly refName: string | null;
  readonly commitSha: string;
  readonly acceptedHistoryThroughCommitSha: string;
  readonly strictEvidenceRequiredAfterCommitSha: string;
  readonly rationale: string | null;
}

const frameworkCommitRangeBaselineRelativePath = '.atm/history/baselines/framework-commit-range.json' as const;

export function readFrameworkCommitRangeBaseline(cwd: string, headRef: string): FrameworkCommitRangeBaseline | null {
  const absolutePath = path.join(cwd, frameworkCommitRangeBaselineRelativePath);
  if (!existsSync(absolutePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Partial<FrameworkCommitRangeBaseline>;
    const commitSha = normalizeOptionalText(parsed.commitSha);
    if (!commitSha) return null;
    const headCommit = runGitScalar(cwd, ['rev-parse', '--verify', headRef]);
    if (!headCommit) return null;
    if (!isAncestorCommit(cwd, commitSha, headCommit)) {
      return null;
    }
    return {
      schemaId: 'atm.frameworkCommitRangeBaseline.v1',
      generatedAt: normalizeOptionalText(parsed.generatedAt) ?? new Date(0).toISOString(),
      name: normalizeOptionalText(parsed.name),
      refName: normalizeOptionalText(parsed.refName),
      commitSha,
      acceptedHistoryThroughCommitSha: normalizeOptionalText(parsed.acceptedHistoryThroughCommitSha) ?? commitSha,
      strictEvidenceRequiredAfterCommitSha: normalizeOptionalText(parsed.strictEvidenceRequiredAfterCommitSha) ?? commitSha,
      rationale: normalizeOptionalText(parsed.rationale)
    };
  } catch {
    return null;
  }
}

export function isCommitAcceptedByLegacyBaseline(cwd: string, commitSha: string, baselineCommitSha: string) {
  return isAncestorCommit(cwd, commitSha, baselineCommitSha);
}

export function isAncestorCommit(cwd: string, maybeAncestor: string, maybeDescendant: string) {
  const result = runGit(cwd, ['merge-base', '--is-ancestor', maybeAncestor, maybeDescendant]);
  return result.exitCode === 0;
}
