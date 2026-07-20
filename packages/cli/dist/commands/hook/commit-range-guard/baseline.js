import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runGit, runGitScalar } from '../git-index-diagnostics.js';
import { normalizeOptionalText } from './support.js';
const frameworkCommitRangeBaselineRelativePath = '.atm/history/baselines/framework-commit-range.json';
export function readFrameworkCommitRangeBaseline(cwd, headRef) {
    const absolutePath = path.join(cwd, frameworkCommitRangeBaselineRelativePath);
    if (!existsSync(absolutePath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
        const commitSha = normalizeOptionalText(parsed.commitSha);
        if (!commitSha)
            return null;
        const headCommit = runGitScalar(cwd, ['rev-parse', '--verify', headRef]);
        if (!headCommit)
            return null;
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
    }
    catch {
        return null;
    }
}
export function isCommitAcceptedByLegacyBaseline(cwd, commitSha, baselineCommitSha) {
    return isAncestorCommit(cwd, commitSha, baselineCommitSha);
}
export function isAncestorCommit(cwd, maybeAncestor, maybeDescendant) {
    const result = runGit(cwd, ['merge-base', '--is-ancestor', maybeAncestor, maybeDescendant]);
    return result.exitCode === 0;
}
