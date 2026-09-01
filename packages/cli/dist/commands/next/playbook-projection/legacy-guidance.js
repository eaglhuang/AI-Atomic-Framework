// @ts-nocheck
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadHumanReviewQueueDocument } from '../../../../../plugin-human-review/dist/index.js';
import { dedupeStrings, quoteCliValue } from '../view-projections.js';
import { parseJsonText } from '../../shared.js';
import { compareGuidedLegacyQueuePriority, compareIsoDesc } from '../match-and-sort.js';
const NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS = 30 * 60;
export function enrichWithLegacyPlan(cwd, base, plan, sessionId) {
    const safeSegments = plan.segments.filter((s) => plan.safeFirstAtoms.includes(s.symbolName));
    const preferredSegment = safeSegments.find((s) => s.recommendedBehavior === 'split')
        ?? safeSegments.find((s) => s.recommendedBehavior === 'infect')
        ?? safeSegments.find((s) => s.recommendedBehavior === 'atomize')
        ?? null;
    const blockedSegments = plan.trunkFunctions;
    if (!preferredSegment) {
        return {
            ...base,
            status: 'blocked',
            reason: 'No safe leaf segment is available in the LegacyRoutePlan. Submit a split proposal before proceeding.',
            blockedSegments
        };
    }
    const legacyTarget = `${plan.targetFile}#${preferredSegment.symbolName}`;
    const queueMatch = findMatchingGuidedLegacyProposal(cwd, {
        guidanceSession: sessionId,
        legacyTarget,
        behaviorId: `behavior.${preferredSegment.recommendedBehavior}`
    });
    if (queueMatch) {
        const actualPatchEvidence = queueMatch.status === 'approved'
            ? findGuidedLegacyActualPatchEvidence(cwd, queueMatch.proposalId)
            : null;
        const command = actualPatchEvidence
            ? `node atm.mjs review rollout-ready ${quoteCliValue(queueMatch.proposalId)} --json`
            : queueMatch.status === 'approved'
                ? `node atm.mjs review apply-ready ${quoteCliValue(queueMatch.proposalId)} --json`
                : `node atm.mjs review show ${quoteCliValue(queueMatch.proposalId)} --json`;
        const waitingForReview = queueMatch.status === 'pending' || queueMatch.status === 'blocked';
        const missingEvidence = reconcileProposalMissingEvidence(base.missingEvidence, preferredSegment.recommendedBehavior, queueMatch.status);
        return {
            ...base,
            status: 'action',
            command,
            reason: actualPatchEvidence
                ? `Approved guided legacy proposal ${queueMatch.proposalId} already has actual patch, smoke evidence, and rollback-ready proof; inspect the rollout-ready packet before closing the governed rollout.`
                : queueMatch.status === 'approved'
                    ? `Approved guided legacy dry-run proposal ${queueMatch.proposalId} already covers ${legacyTarget}; inspect the approved boundary and proceed with actual patch planning inside that safe leaf.`
                    : `Matching guided legacy dry-run proposal ${queueMatch.proposalId} already exists for ${legacyTarget}; inspect that proposal instead of generating a duplicate.`,
            allowedCommands: Array.from(new Set([...base.allowedCommands, command])),
            selectedSegment: preferredSegment.symbolName,
            legacyTarget,
            targetFile: plan.targetFile,
            selectedBehavior: preferredSegment.recommendedBehavior,
            blockedSegments,
            proposalId: queueMatch.proposalId,
            proposalStatus: queueMatch.status,
            nextRouteState: actualPatchEvidence
                ? 'proposal-rollout-ready'
                : queueMatch.status === 'approved'
                    ? 'proposal-approved'
                    : queueMatch.status === 'rejected'
                        ? 'proposal-rejected'
                        : 'proposal-pending-review',
            missingEvidence: actualPatchEvidence
                ? []
                : waitingForReview
                    ? dedupeStrings([...missingEvidence, 'human review before apply'])
                    : missingEvidence
        };
    }
    const command = `node atm.mjs upgrade --propose --behavior behavior.${preferredSegment.recommendedBehavior} --legacy-target ${quoteCliValue(legacyTarget)} --guidance-session ${quoteCliValue(sessionId)} --dry-run --json`;
    return {
        ...base,
        status: 'action',
        command,
        allowedCommands: Array.from(new Set([...base.allowedCommands, command])),
        selectedSegment: preferredSegment.symbolName,
        legacyTarget,
        targetFile: plan.targetFile,
        selectedBehavior: preferredSegment.recommendedBehavior,
        blockedSegments,
        nextRouteState: 'proposal-required'
    };
}
function findMatchingGuidedLegacyProposal(cwd, criteria) {
    const queuePath = path.join(cwd, '.atm', 'history', 'reports', 'upgrade-proposals.json');
    const queue = loadHumanReviewQueueDocument(queuePath);
    if (!queue) {
        return null;
    }
    const matches = queue.entries
        .filter((entry) => isMatchingGuidedLegacyProposal(entry, criteria))
        .sort(compareGuidedLegacyQueuePriority);
    const selected = matches[0];
    if (!selected) {
        return null;
    }
    return {
        proposalId: selected.proposalId,
        status: selected.status
    };
}
function isMatchingGuidedLegacyProposal(entry, criteria) {
    return entry.proposal.guidanceSession === criteria.guidanceSession
        && entry.proposal.legacyTarget === criteria.legacyTarget
        && entry.proposal.behaviorId === criteria.behaviorId;
}
function findGuidedLegacyActualPatchEvidence(cwd, proposalId) {
    const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
    if (!existsSync(reportsRoot)) {
        return null;
    }
    const matches = readdirSync(reportsRoot)
        .filter((entry) => entry.startsWith('actual-patch-evidence.') && entry.endsWith('.json'))
        .flatMap((entry) => {
        const reportPath = path.join(reportsRoot, entry);
        try {
            const parsed = parseJsonText(readFileSync(reportPath, 'utf8'));
            if (parsed['proposalId'] !== proposalId) {
                return [];
            }
            const smokeEvidence = Array.isArray(parsed['smokeEvidence']) ? parsed['smokeEvidence'] : [];
            const rollbackReadyProof = parsed['rollbackReadyProof'] && typeof parsed['rollbackReadyProof'] === 'object'
                ? parsed['rollbackReadyProof']
                : null;
            if (smokeEvidence.length === 0 || !rollbackReadyProof?.proofPath) {
                return [];
            }
            return [{
                    reportPath: path.relative(cwd, reportPath).replace(/\\/g, '/'),
                    proposalId,
                    generatedAt: typeof parsed['generatedAt'] === 'string' ? parsed['generatedAt'] : undefined,
                    smokeEvidence,
                    rollbackReadyProof
                }];
        }
        catch {
            return [];
        }
    })
        .sort((left, right) => compareIsoDesc(left.generatedAt, right.generatedAt));
    return matches[0] ?? null;
}
function reconcileProposalMissingEvidence(missingEvidence, behavior, proposalStatus) {
    const filtered = missingEvidence.filter((entry) => entry !== `${behavior} dry-run proposal`);
    if (proposalStatus === 'approved' || proposalStatus === 'rejected') {
        return filtered.filter((entry) => entry !== 'human review before apply');
    }
    return filtered;
}
