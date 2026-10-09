// Steward input validation, split out of steward.ts so the steward stays
// within the physical line budget. The identity gate (issue #196) keeps a
// proposer from acting as the neutral steward for its own proposal.
import path from 'node:path';
import { validateBrokerProposal } from './proposal.js';
import { proposalRegionIdentity } from './steward-region-rebase.js';
/** A steward must be neutral: it may not share an identity with any proposer it applies. */
export function checkStewardIsNotProposer(stewardId, proposals) {
    const steward = (stewardId ?? '').trim();
    if (!steward)
        return [];
    return proposals
        .filter((proposal) => proposal.actorId.trim() === steward)
        .map((proposal) => ({
        code: 'invalid-steward-identity',
        detail: `Steward '${steward}' authored proposal '${proposal.proposalId}'; a proposer cannot apply its own proposal.`
    }));
}
export function validateStewardInputs(input) {
    const issues = [];
    const cwd = path.resolve(input.cwd);
    const scopeSet = new Set(input.scopeFiles.map((entry) => normalizeRepoPath(cwd, entry)).filter(Boolean));
    if (input.mergePlan.schemaId !== 'atm.mergePlan.v1') {
        issues.push({ code: 'invalid-merge-plan', detail: `Unexpected merge plan schemaId '${input.mergePlan.schemaId}'.` });
    }
    // Steward takeover is only allowed if the conflict verdict says it is safe ('needs-steward' or 'parallel-safe')
    if (input.mergePlan.verdict === 'blocked-cid-conflict' || input.mergePlan.verdict === 'blocked-shared-surface') {
        issues.push({ code: 'blocked-merge-plan', detail: `Merge plan verdict '${input.mergePlan.verdict}' cannot be applied by steward.` });
    }
    // Human-required verdicts are fail-closed at the arbitration layer,
    // but if someone calls planStewardApply directly with one, block it too.
    if (input.mergePlan.verdict === 'human-required') {
        issues.push({ code: 'human-review-required', detail: 'Merge plan verdict is human-required; steward cannot auto-resolve.' });
    }
    issues.push(...checkStewardIsNotProposer(input.stewardId, input.proposals));
    const proposalIds = new Set(input.proposals.map((proposal) => proposal.proposalId));
    for (const expectedId of input.mergePlan.inputProposals) {
        if (!proposalIds.has(expectedId)) {
            issues.push({ code: 'missing-proposal', detail: `Merge plan references missing proposal '${expectedId}'.` });
        }
    }
    if (input.mergePlan.inputProposals.length !== input.proposals.length) {
        issues.push({ code: 'invalid-merge-plan', detail: 'Proposal count does not match merge plan inputProposals.' });
    }
    for (const proposal of input.proposals) {
        const normalizedTarget = normalizeRepoPath(cwd, proposal.targetFile);
        if (!normalizedTarget || isPathOutsideRoot(cwd, path.resolve(cwd, proposal.targetFile))) {
            issues.push({ code: 'out-of-scope-target', detail: `Target file is outside repository root: ${proposal.targetFile}` });
            continue;
        }
        if (scopeSet.size > 0 && !scopeSet.has(normalizedTarget)) {
            issues.push({ code: 'scope-lock-mismatch', detail: `Target file '${proposal.targetFile}' is outside steward scope lock.` });
        }
        const validation = validateBrokerProposal(proposal, { cwd });
        for (const issue of validation.issues) {
            if (issue.kind === 'stale-base-commit') {
                issues.push({ code: 'stale-base-commit', detail: issue.detail });
            }
            if (issue.kind === 'file-hash-mismatch') {
                const missingFile = issue.detail.includes('does not exist');
                // 有穩定區域身分時，hash drift 交給區域重定，而不是在計畫階段直接結束。
                if (missingFile || proposalRegionIdentity(proposal) === null) {
                    issues.push({ code: 'file-hash-drift', detail: issue.detail });
                }
            }
            if (issue.kind === 'out-of-scope-target-file') {
                issues.push({ code: 'out-of-scope-target', detail: issue.detail });
            }
        }
    }
    return dedupeIssues(issues);
}
function normalizeRepoPath(cwd, candidate) {
    const normalized = path.normalize(candidate).replace(/\\/g, '/');
    if (!normalized)
        return '';
    const absolute = path.isAbsolute(normalized) ? path.resolve(normalized) : path.resolve(cwd, normalized);
    const relative = path.relative(cwd, absolute).replace(/\\/g, '/');
    if (relative.startsWith('..') || path.isAbsolute(relative))
        return '';
    return relative;
}
function isPathOutsideRoot(root, candidatePath) {
    const relative = path.relative(path.resolve(root), path.resolve(candidatePath));
    return relative.startsWith('..') || path.isAbsolute(relative);
}
function dedupeIssues(issues) {
    const seen = new Set();
    const unique = [];
    for (const issue of issues) {
        const key = `${issue.code}::${issue.detail}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        unique.push(issue);
    }
    return unique.sort((left, right) => `${left.code}::${left.detail}`.localeCompare(`${right.code}::${right.detail}`));
}
