import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHumanReviewQueueDocument, createHumanReviewQueueRecord, findHumanReviewQueueRecord, loadHumanReviewQueueDocument, renderHumanReviewQueueMarkdown, replaceHumanReviewQueueRecord, writeHumanReviewQueueDocument } from '../../../../../plugin-human-review/dist/index.js';
import { makeResult, message } from '../../shared.js';
export function isGuidedLegacyDryRun(options) {
    return options.propose === true
        && options.dryRun === true
        && typeof options.legacyTarget === 'string'
        && typeof options.guidanceSession === 'string'
        && ['behavior.atomize', 'behavior.infect', 'behavior.split'].includes(options.behaviorId);
}
export function runGuidedLegacyDryRunProposal(options) {
    const behaviorName = String(options.behaviorId).replace(/^behavior\./, '');
    const proposalId = options.proposalId
        ?? `guided-legacy-${behaviorName}-${sanitizeUpgradeBudgetId(options.guidanceSession).toLowerCase()}`;
    const proposal = {
        schemaId: 'atm.guidedLegacyDryRunProposal',
        specVersion: '0.1.0',
        proposalId,
        atomId: `LEGACY-GUIDED-${sanitizeUpgradeBudgetId(behaviorName).toUpperCase()}`,
        fromVersion: 'legacy',
        toVersion: 'guided-dry-run',
        behaviorId: options.behaviorId,
        decompositionDecision: behaviorName,
        legacyTarget: options.legacyTarget,
        guidanceSession: options.guidanceSession,
        patchMode: 'dry-run',
        automatedGates: {
            allPassed: true,
            blockedGateNames: []
        },
        status: 'pending',
        reviewRequired: true,
        rollbackProofRequired: true,
        rollbackInstructions: [
            'Do not apply generated host changes until human review approves the dry-run proposal.',
            'Discard generated proposal artifacts to roll back the preview, then rerun atm next before retrying.'
        ],
        proposedBy: options.proposedBy,
        proposedAt: options.proposedAt
    };
    const queued = enqueueGuidedLegacyProposal(options.cwd, proposal);
    return makeResult({
        ok: true,
        command: 'upgrade',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_UPGRADE_PROPOSAL_READY', 'Guided legacy dry-run proposal prepared and ready for review.', {
                proposalId
            })
        ],
        evidence: {
            proposal,
            proposalId,
            status: 'ready-for-review',
            queuePath: queued.queuePath,
            projectionPath: queued.projectionPath,
            queued: true,
            dryRun: true,
            behaviorId: options.behaviorId,
            legacyTarget: options.legacyTarget,
            guidanceSession: options.guidanceSession,
            humanReviewRequired: true,
            rollbackProofRequired: true
        }
    });
}
function enqueueGuidedLegacyProposal(cwd, proposal) {
    const queuePath = path.join(cwd, '.atm', 'history', 'reports', 'upgrade-proposals.json');
    const projectionPath = path.join(cwd, '.atm', 'history', 'reports', 'upgrade-proposals.md');
    const existingQueue = loadHumanReviewQueueDocument(queuePath)
        ?? createHumanReviewQueueDocument([], { generatedAt: new Date().toISOString() });
    const nextRecord = createHumanReviewQueueRecord(proposal, { status: 'pending' });
    const nextQueue = findHumanReviewQueueRecord(existingQueue, nextRecord.proposalId)
        ? replaceHumanReviewQueueRecord(existingQueue, nextRecord)
        : createHumanReviewQueueDocument([...existingQueue.entries, nextRecord], {
            generatedAt: new Date().toISOString(),
            migration: existingQueue.migration
        });
    writeHumanReviewQueueDocument(queuePath, nextQueue);
    mkdirSync(path.dirname(projectionPath), { recursive: true });
    writeFileSync(projectionPath, renderHumanReviewQueueMarkdown(nextQueue), 'utf8');
    return {
        queuePath: path.relative(cwd, queuePath).replace(/\\/g, '/'),
        projectionPath: path.relative(cwd, projectionPath).replace(/\\/g, '/')
    };
}
export function sanitizeUpgradeBudgetId(value) {
    return String(value || 'context-budget').replace(/\\/g, '/').replace(/[/:]+/g, '-');
}
