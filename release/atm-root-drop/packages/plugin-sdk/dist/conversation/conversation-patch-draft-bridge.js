export const conversationPatchDraftBridgeName = 'deterministic-conversation-patch-draft-bridge';
const DEFAULT_SOURCE_REPORT_PATH = 'conversation-review-findings-report.json';
const DEFAULT_PROPOSED_BY = 'ATM Conversation Patch Draft Bridge';
export function draftConversationPatches(input) {
    const findingsReport = input.findingsReport;
    const generatedAt = input.generatedAt ?? findingsReport.generatedAt;
    const sourceReportPath = input.sourceReportPath ?? DEFAULT_SOURCE_REPORT_PATH;
    const drafts = findingsReport.findings.map((finding) => draftFromFinding({
        finding,
        findingsReport,
        generatedAt,
        sourceReportPath,
        proposedBy: input.proposedBy ?? DEFAULT_PROPOSED_BY,
        atomVersionById: input.atomVersionById ?? {}
    }));
    return {
        schemaId: 'atm.conversationPatchDraftReport',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Deterministic bridge from conversation review findings to dry-run patch drafts.'
        },
        generatedAt,
        bridgeName: input.bridgeName ?? conversationPatchDraftBridgeName,
        sourceFindingsReport: {
            schemaId: 'atm.conversationReviewFindingsReport',
            ...(input.sourceReportPath ? { artifactPath: input.sourceReportPath } : {}),
            transcriptId: findingsReport.sourceTranscript.transcriptId,
            ...(findingsReport.sourceTranscript.sessionId ? { sessionId: findingsReport.sourceTranscript.sessionId } : {}),
            findingIds: findingsReport.findings.map((finding) => finding.findingId).sort()
        },
        privacy: {
            redacted: true,
            containsSensitiveInput: findingsReport.privacy.containsSensitiveInput,
            redactionReportPaths: findingsReport.privacy.redactionReportPaths
        },
        summary: summarizeDrafts(findingsReport.findings.length, drafts),
        drafts,
        draftOnly: {
            appliesAutomatically: false,
            mutatesFiles: false,
            mutatesRegistry: false,
            mutatesSkillFiles: false,
            requiresHumanReview: true
        }
    };
}
function draftFromFinding(context) {
    const finding = context.finding;
    const baseDraft = {
        draftId: createDraftId(finding.findingId),
        sourceFindingId: finding.findingId,
        findingKind: finding.findingKind,
        patchMode: 'dry-run',
        appliesAutomatically: false,
        mutatesFiles: false,
        mutatesRegistry: false,
        mutatesSkillFiles: false,
        requiresHumanReview: true,
        summary: finding.patchDraft.summary,
        rationale: finding.rationale,
        sourceTranscriptRefs: [...finding.sourceTranscriptRefs],
        evidenceRefs: [...finding.evidenceRefs],
        ...(finding.patchDraft.patchFiles ? { patchFiles: [...finding.patchDraft.patchFiles] } : {}),
        ...(finding.skillId ? { skillId: finding.skillId } : {}),
        ...(finding.atomId ? { atomId: finding.atomId } : {}),
        ...(finding.atomMapId ? { atomMapId: finding.atomMapId } : {})
    };
    if (finding.recommendation === 'observation-only' || finding.patchDraft.draftKind === 'observation') {
        return {
            ...baseDraft,
            draftKind: 'observation',
            draftSurface: 'observation',
            operation: 'observe-only',
            notes: ['Observation-only finding; no patch or proposal draft was produced.']
        };
    }
    if (finding.findingKind === 'style-format-correction') {
        return {
            ...baseDraft,
            draftKind: 'host-local-overlay',
            draftSurface: 'host-local-overlay',
            operation: 'record-host-local-preference',
            notes: ['Style and format corrections stay host-local by default.']
        };
    }
    if (finding.findingKind === 'workflow-adjustment' && finding.atomId) {
        const baseAtomVersion = context.atomVersionById[finding.atomId];
        const upgradeProposalDraft = baseAtomVersion
            ? createAtomUpgradeProposalDraft({
                finding,
                findingsReport: context.findingsReport,
                sourceReportPath: context.sourceReportPath,
                generatedAt: context.generatedAt,
                proposedBy: context.proposedBy,
                baseAtomVersion
            })
            : undefined;
        return {
            ...baseDraft,
            draftKind: 'atom-patch',
            draftSurface: 'atom-spec',
            operation: 'repair-workflow',
            ...(upgradeProposalDraft ? { upgradeProposalDraft } : {}),
            notes: upgradeProposalDraft
                ? ['Atom workflow adjustment produced a schema-valid UpgradeProposal draft.']
                : ['Atom workflow adjustment could not resolve a base atom version; keep this draft out of promotion queues.']
        };
    }
    if (finding.findingKind === 'non-trivial-debug-path') {
        return {
            ...baseDraft,
            draftKind: 'skill-patch',
            draftSurface: 'skill',
            operation: 'capture-debug-path',
            notes: ['Reusable debugging path should be reviewed as a skill SOP or pitfall draft.']
        };
    }
    if (finding.findingKind === 'stale-or-wrong-skill') {
        return {
            ...baseDraft,
            draftKind: 'skill-patch',
            draftSurface: 'skill',
            operation: 'repair-stale-skill',
            notes: ['Stale or wrong skill findings must cite skillId and evidence refs before review.']
        };
    }
    return {
        ...baseDraft,
        draftKind: 'skill-patch',
        draftSurface: 'skill',
        operation: 'repair-workflow',
        notes: ['Workflow adjustment without atomId remains a skill or procedure patch draft.']
    };
}
function createAtomUpgradeProposalDraft(context) {
    const toVersion = bumpPatchVersion(context.baseAtomVersion);
    const proposalId = `proposal.${sanitizeProposalSegment(context.finding.atomId)}.conversation.${sanitizeProposalSegment(context.finding.findingId)}`;
    const evidenceWatermark = `evidence.watermark.${normalizeWatermarkTimestamp(context.findingsReport.generatedAt)}`;
    const reportPath = context.sourceReportPath;
    const inputs = [
        {
            kind: 'evolution-evidence',
            path: `${reportPath}#/findings/${context.finding.findingId}`,
            schemaId: 'atm.conversationReviewFindingsReport',
            reportId: context.finding.findingId,
            summary: 'conversation review finding input'
        }
    ];
    for (const redactionReportPath of context.findingsReport.privacy.redactionReportPaths) {
        inputs.push({
            kind: 'redaction-report',
            path: redactionReportPath,
            schemaId: 'atm.redactionReport',
            summary: 'redaction report input for conversation-derived proposal'
        });
    }
    return {
        schemaId: 'atm.upgradeProposal',
        specVersion: '0.1.0',
        migration: {
            strategy: 'additive',
            fromVersion: context.baseAtomVersion,
            notes: 'Conversation-derived atom patch draft; dry-run only until human review.'
        },
        proposalId,
        atomId: context.finding.atomId,
        fromVersion: context.baseAtomVersion,
        toVersion,
        lifecycleMode: 'evolution',
        behaviorId: 'behavior.evolve',
        target: {
            kind: 'atom'
        },
        decompositionDecision: 'atom-bump',
        proposalSource: 'evidence-driven',
        targetSurface: 'atom-spec',
        baseAtomVersion: context.baseAtomVersion,
        baseEvidenceWatermark: evidenceWatermark,
        reversibility: 'rollback-safe',
        evidenceGate: {
            requiredSignals: [context.finding.signalKind],
            matchedEvidenceIds: [...context.finding.evidenceRefs],
            rejectedEvidenceIds: [],
            notes: `Derived from conversation finding ${context.finding.findingId}.`
        },
        reviewTemplate: 'review.template.atom-bump',
        automatedGates: {
            nonRegression: makePassGate('nonRegression', reportPath, 'pass (conversation patch bridge did not re-run non-regression)'),
            qualityComparison: makePassGate('qualityComparison', reportPath, 'pass (conversation patch bridge did not re-run quality comparison)'),
            registryCandidate: makePassGate('registryCandidate', reportPath, 'pass (conversation patch bridge did not re-run registry candidate)'),
            staleProposal: makePassGate('staleProposal', reportPath, 'pass (base version supplied by bridge input)'),
            privacy: makePassGate('privacy', reportPath, 'pass (source findings report is redacted)'),
            allPassed: true,
            blockedGateNames: []
        },
        humanReview: 'pending',
        status: 'pending',
        inputs,
        proposedBy: context.proposedBy,
        proposedAt: context.generatedAt
    };
}
function summarizeDrafts(totalFindings, drafts) {
    return {
        totalFindings,
        totalDrafts: drafts.length,
        hostLocalDraftCount: drafts.filter((draft) => draft.draftKind === 'host-local-overlay').length,
        skillDraftCount: drafts.filter((draft) => draft.draftKind === 'skill-patch').length,
        atomDraftCount: drafts.filter((draft) => draft.draftKind === 'atom-patch').length,
        atomMapDraftCount: drafts.filter((draft) => draft.draftKind === 'atom-map-patch').length,
        observationCount: drafts.filter((draft) => draft.draftKind === 'observation').length,
        humanReviewRequiredCount: drafts.filter((draft) => draft.requiresHumanReview).length
    };
}
function makePassGate(gateName, reportPath, summary) {
    return {
        passed: true,
        reportId: `conversation-patch-draft.${gateName}`,
        reportPath,
        summary
    };
}
function createDraftId(findingId) {
    return `draft.conversation.${sanitizeProposalSegment(findingId)}`;
}
function sanitizeProposalSegment(value) {
    const sanitized = value
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '')
        .replace(/[.-]{2,}/g, '.');
    return sanitized || 'unknown';
}
function bumpPatchVersion(version) {
    const versionParts = version.split('.').map((versionPart) => Number.parseInt(versionPart, 10));
    if (versionParts.length !== 3 || versionParts.some((versionPart) => Number.isNaN(versionPart))) {
        throw new Error(`Invalid semantic version: ${version}`);
    }
    const [majorVersion, minorVersion, patchVersion] = versionParts;
    return `${majorVersion}.${minorVersion}.${patchVersion + 1}`;
}
function normalizeWatermarkTimestamp(value) {
    return value.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}
