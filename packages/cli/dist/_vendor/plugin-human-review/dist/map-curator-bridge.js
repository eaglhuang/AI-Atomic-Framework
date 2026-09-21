import { createHumanReviewQueueRecord } from './queue.js';
const DEFAULT_PROPOSED_BY = 'ATM Atom Map Curator';
const DEFAULT_REPORT_PATH = 'docs/reports/split-suggestion-evidence/split-suggestion-curator-report.json';
export function createAtomMapPatchReviewProposalSnapshot(patchDraft, options = {}) {
    const fromVersion = options.baseMapVersion ?? '0.1.0';
    const toVersion = bumpPatchVersion(fromVersion);
    const proposedAt = options.generatedAt ?? new Date().toISOString();
    const reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
    return {
        schemaId: 'atm.upgradeProposal',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Broker split suggestion promoted into a human-reviewable atom-map split plan.'
        },
        proposalId: `proposal.map-curator.patch.${sanitizeIdentifier(patchDraft.candidateId)}`,
        atomId: patchDraft.targetMapId,
        fromVersion,
        toVersion,
        lifecycleMode: 'evolution',
        behaviorId: 'behavior.split',
        target: {
            kind: 'map',
            mapId: patchDraft.targetMapId
        },
        decompositionDecision: 'split',
        proposalSource: 'broker-split-suggestion',
        targetSurface: 'atom-map',
        reviewTemplate: 'review.template.split',
        automatedGates: {
            allPassed: true,
            blockedGateNames: []
        },
        humanReview: 'pending',
        status: 'pending',
        patchDraft: cloneJson(patchDraft),
        inputs: [
            {
                kind: 'evolution-evidence',
                path: reportPath,
                schemaId: 'atm.atomMapCuratorReport',
                reportId: `map-curator-review.${sanitizeIdentifier(patchDraft.candidateId)}`,
                summary: `Curator patch draft derived from broker split suggestion ${patchDraft.candidateId}.`
            }
        ],
        proposedBy: options.proposedBy ?? DEFAULT_PROPOSED_BY,
        proposedAt
    };
}
export function createAtomMapPatchReviewQueueRecord(patchDraft, options = {}) {
    return createHumanReviewQueueRecord(createAtomMapPatchReviewProposalSnapshot(patchDraft, options));
}
function bumpPatchVersion(version) {
    const parts = version.split('.').map((entry) => Number.parseInt(entry, 10));
    if (parts.length !== 3 || parts.some((entry) => Number.isNaN(entry))) {
        throw new Error(`Invalid semantic version: ${version}`);
    }
    const [major, minor, patch] = parts;
    return `${major}.${minor}.${patch + 1}`;
}
function sanitizeIdentifier(value) {
    return value.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
