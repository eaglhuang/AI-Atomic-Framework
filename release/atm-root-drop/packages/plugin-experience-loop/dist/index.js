import { createHash } from 'node:crypto';
export const pluginExperienceLoopPackage = {
    packageName: '@ai-atomic-framework/plugin-experience-loop',
    packageRole: 'experience-loop-learning-artifacts',
    packageVersion: '0.0.0'
};
export const defaultExperienceLoopThresholds = Object.freeze({
    extractSkillConfidenceThreshold: 0.6,
    skillAmendWindow: 10,
    skillAmendFailureCount: 3,
    memoryNudgePatternCount: 3
});
const detectorPatterns = Object.freeze([
    { tag: 'missing-adapter', terms: ['adapter missing', 'missing adapter', 'adapter boundary'] },
    { tag: 'validation-gap', terms: ['validation gap', 'missing validation', 'no validator'] },
    { tag: 'review-needed', terms: ['review required', 'needs review', 'human review'] },
    { tag: 'recurring-error', terms: ['repeated', 'recurring', 'again'] },
    { tag: 'contract-drift', terms: ['contract drift', 'schema drift', 'registry drift'] }
]);
export function extractSkillCandidate(input, thresholds = defaultExperienceLoopThresholds) {
    const sourceTaskId = normalizeRequiredText(input.sourceTaskId, 'sourceTaskId');
    const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    const patternTags = collectPatternTags(evidence);
    const evidenceRefs = collectEvidenceRefs(evidence);
    const generatedAt = input.now ?? new Date().toISOString();
    const proposedName = normalizeSkillName(input.proposedName ?? inferSkillName(sourceTaskId, patternTags));
    const confidence = calculateExtractionConfidence(evidence, patternTags, input.contextSummary, input.diffSummary);
    const candidate = {
        schemaVersion: 'atm.skillCandidate.v0.1',
        id: createStableId('skill-candidate', { sourceTaskId, patternTags, evidenceRefs, proposedName }),
        sourceTaskId,
        proposedName,
        proposedDescription: createSkillDescription(sourceTaskId, patternTags),
        proposedApplyTo: normalizeApplyTo(input.proposedApplyTo),
        proposedSteps: createProposedSteps(evidence, input.contextSummary),
        confidence,
        patternTags,
        evidenceRefs,
        lifecycleMode: 'birth',
        status: 'candidate',
        generatedAt,
        review: {
            required: true,
            route: ['plugin-review-advisory', 'plugin-human-review']
        }
    };
    return {
        ok: confidence >= thresholds.extractSkillConfidenceThreshold,
        candidate,
        threshold: thresholds.extractSkillConfidenceThreshold,
        messages: confidence >= thresholds.extractSkillConfidenceThreshold
            ? ['Skill candidate crossed the extraction threshold.']
            : ['Skill candidate generated below the extraction threshold; keep it advisory.']
    };
}
export function createExperienceHumanReviewProposalSnapshot(input) {
    const atomId = normalizeRequiredText(input.atomId, 'atomId');
    const candidateId = 'id' in input.candidate ? input.candidate.id : createStableId('experience-candidate', input.candidate);
    return {
        proposalId: `experience.${candidateId}`,
        atomId,
        fromVersion: input.kind === 'skill-amendment' ? '0.1.0' : '0.0.0',
        toVersion: '0.1.0',
        decompositionDecision: input.kind === 'skill-amendment' ? 'atom-bump' : 'atom-extract',
        automatedGates: {
            allPassed: input.automatedGatePassed,
            blockedGateNames: input.automatedGatePassed ? [] : [...(input.blockedGateNames ?? ['experience-loop-threshold'])]
        },
        status: 'pending',
        proposedAt: 'generatedAt' in input.candidate ? input.candidate.generatedAt : new Date().toISOString(),
        experienceKind: input.kind,
        reviewRoute: ['plugin-review-advisory', 'plugin-human-review'],
        candidate: input.candidate
    };
}
export function createSkillAmendmentProposal(input, thresholds = defaultExperienceLoopThresholds) {
    const targetSkillId = normalizeRequiredText(input.targetSkillId, 'targetSkillId');
    const usageWindow = input.usageHistory.slice(-thresholds.skillAmendWindow);
    const failedUsages = usageWindow.filter((usageRecord) => usageRecord.ok === false);
    const triggeringTags = collectPatternTags(input.triggeringEvidence);
    const evidenceRefs = collectEvidenceRefs(input.triggeringEvidence);
    const confidence = clampConfidence(0.4 + failedUsages.length * 0.08 + triggeringTags.length * 0.04);
    const status = failedUsages.length >= thresholds.skillAmendFailureCount ? 'candidate' : 'suppressed';
    return {
        schemaVersion: 'atm.skillAmendmentProposal.v0.1',
        id: createStableId('skill-amendment', { targetSkillId, triggeringTags, evidenceRefs, status }),
        targetSkillId,
        rationale: input.rationale ?? `Observed ${failedUsages.length} failed usage records in the configured window.`,
        proposedChangeSummary: createAmendmentSummary(targetSkillId, triggeringTags),
        confidence,
        evidenceRefs,
        lifecycleMode: 'evolution',
        status,
        generatedAt: input.now ?? new Date().toISOString()
    };
}
export function createMemoryNudges(input, thresholds = defaultExperienceLoopThresholds) {
    const workItemId = normalizeRequiredText(input.workItemId, 'workItemId');
    const scope = input.scope ?? 'repo';
    const generatedAt = input.now ?? new Date().toISOString();
    const patternCounts = countPatternTags(input.evidence);
    const evidenceRefs = collectEvidenceRefs(input.evidence);
    return Array.from(patternCounts.entries())
        .filter(([, count]) => count >= thresholds.memoryNudgePatternCount)
        .sort(([leftTag], [rightTag]) => leftTag.localeCompare(rightTag))
        .map(([patternTag, count]) => ({
        schemaVersion: 'atm.memoryNudge.v0.1',
        id: createStableId('memory-nudge', { workItemId, scope, patternTag, count }),
        workItemId,
        scope,
        suggestedKey: `${patternTag}.md`,
        suggestedContent: `Remember the recurring ATM experience pattern: ${patternTag}.`,
        rationale: `Pattern ${patternTag} appeared in ${count} evidence records.`,
        evidenceRefs,
        generatedAt
    }));
}
export const experienceExtractSkillBehavior = {
    behaviorId: 'experience-extract-skill-behavior',
    actionCategories: ['experience.extract-skill'],
    execute(_context, input) {
        if (input.action !== 'experience.extract-skill') {
            return createExperienceBehaviorFailure('experience-extract-action-mismatch', { action: input.action });
        }
        const payload = (input.payload ?? {});
        const extractionInput = normalizeExtractionPayload(payload);
        const report = extractSkillCandidate(extractionInput);
        const proposalSnapshot = createExperienceHumanReviewProposalSnapshot({
            kind: 'skill-candidate',
            atomId: input.atomId ?? 'ATM-EXP-0001',
            candidate: report.candidate,
            automatedGatePassed: report.ok,
            blockedGateNames: report.ok ? [] : ['extract-skill-confidence-threshold']
        });
        return {
            ok: report.ok,
            registryTransition: {
                fromStatus: 'active',
                toStatus: 'active',
                governanceTier: 'standard',
                notes: 'Experience extraction emits a reviewable skill candidate and does not mutate the registry.'
            },
            rollbackPlan: {
                steps: [
                    'discard the generated skill candidate artifact',
                    'leave the source task evidence unchanged',
                    'require human review before promotion'
                ]
            },
            issues: report.ok ? [] : ['extract-skill-confidence-threshold-not-met'],
            evidence: [
                {
                    evidenceKind: 'validation',
                    summary: 'Experience extract-skill behavior generated a reviewable candidate.',
                    artifactPaths: [],
                    patternTags: report.candidate.patternTags,
                    recurringSignal: report.candidate.patternTags.includes('recurring-error'),
                    details: {
                        action: input.action,
                        skillCandidate: report.candidate,
                        proposalSnapshot,
                        threshold: report.threshold,
                        crossedThreshold: report.ok,
                        reviewRequired: true,
                        mutation: 'none'
                    }
                }
            ]
        };
    }
};
export const experienceSkillAmendBehavior = {
    behaviorId: 'experience-skill-amend-behavior',
    actionCategories: ['experience.amend-skill'],
    execute(_context, input) {
        if (input.action !== 'experience.amend-skill') {
            return createExperienceBehaviorFailure('experience-amend-action-mismatch', { action: input.action });
        }
        const payload = (input.payload ?? {});
        const proposal = createSkillAmendmentProposal({
            targetSkillId: String(payload.targetSkillId ?? input.atomId ?? '').trim(),
            triggeringEvidence: Array.isArray(payload.triggeringEvidence) ? payload.triggeringEvidence : [],
            usageHistory: Array.isArray(payload.usageHistory) ? payload.usageHistory : [],
            rationale: typeof payload.rationale === 'string' ? payload.rationale : undefined
        });
        const proposalSnapshot = createExperienceHumanReviewProposalSnapshot({
            kind: 'skill-amendment',
            atomId: input.atomId ?? proposal.targetSkillId,
            candidate: proposal,
            automatedGatePassed: proposal.status === 'candidate',
            blockedGateNames: proposal.status === 'candidate' ? [] : ['skill-amendment-threshold']
        });
        return {
            ok: proposal.status === 'candidate',
            registryTransition: {
                fromStatus: 'active',
                toStatus: 'active',
                governanceTier: 'standard',
                notes: 'Skill amendment behavior emits a proposal and requires review before promotion.'
            },
            rollbackPlan: {
                steps: ['discard the generated amendment proposal', 'keep the existing skill unchanged']
            },
            issues: proposal.status === 'candidate' ? [] : ['skill-amendment-threshold-not-met'],
            evidence: [
                {
                    evidenceKind: 'validation',
                    summary: 'Experience amend-skill behavior generated a reviewable amendment proposal.',
                    artifactPaths: [],
                    details: {
                        action: input.action,
                        skillAmendmentProposal: proposal,
                        proposalSnapshot,
                        reviewRequired: true,
                        mutation: 'none'
                    }
                }
            ]
        };
    }
};
export const experienceMemoryNudgeBehavior = {
    behaviorId: 'experience-memory-nudge-behavior',
    actionCategories: ['experience.memory-nudge'],
    execute(_context, input) {
        if (input.action !== 'experience.memory-nudge') {
            return createExperienceBehaviorFailure('experience-memory-nudge-action-mismatch', { action: input.action });
        }
        const payload = (input.payload ?? {});
        const nudges = createMemoryNudges({
            workItemId: String(payload.workItemId ?? input.atomId ?? input.mapId ?? '').trim(),
            evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
            scope: payload.scope === 'user' || payload.scope === 'session' || payload.scope === 'repo' ? payload.scope : undefined
        });
        return {
            ok: nudges.length > 0,
            registryTransition: {
                fromStatus: 'active',
                toStatus: 'active',
                governanceTier: 'standard',
                notes: 'Memory nudge behavior emits host-routed suggestions and does not persist memory directly.'
            },
            rollbackPlan: {
                steps: ['discard unaccepted memory nudges', 'do not mutate host memory without adapter approval']
            },
            issues: nudges.length > 0 ? [] : ['memory-nudge-threshold-not-met'],
            evidence: [
                {
                    evidenceKind: 'validation',
                    summary: 'Experience memory-nudge behavior generated host-routed memory suggestions.',
                    artifactPaths: [],
                    details: {
                        action: input.action,
                        memoryNudges: nudges,
                        reviewRequired: true,
                        mutation: 'none'
                    }
                }
            ]
        };
    }
};
export const experienceLoopBehaviors = Object.freeze([
    experienceExtractSkillBehavior,
    experienceSkillAmendBehavior,
    experienceMemoryNudgeBehavior
]);
export function registerExperienceLoopBehaviors(registry) {
    for (const behavior of experienceLoopBehaviors)
        registry.register(behavior);
}
function collectPatternTags(evidence) {
    const tags = new Set();
    for (const evidenceRecord of evidence) {
        for (const tag of readPatternTags(evidenceRecord))
            tags.add(tag);
        const summary = evidenceRecord.summary.toLowerCase();
        for (const detectorPattern of detectorPatterns) {
            if (detectorPattern.terms.some((term) => summary.includes(term))) {
                tags.add(detectorPattern.tag);
            }
        }
        if (evidenceRecord.recurringSignal === true)
            tags.add('recurring-error');
    }
    return Array.from(tags).sort((leftTag, rightTag) => leftTag.localeCompare(rightTag));
}
function normalizeExtractionPayload(payload) {
    const extractionInput = payload.extractionInput && typeof payload.extractionInput === 'object'
        ? payload.extractionInput
        : payload;
    return {
        sourceTaskId: String(extractionInput.sourceTaskId ?? extractionInput.taskId ?? '').trim(),
        evidence: Array.isArray(extractionInput.evidence) ? extractionInput.evidence : [],
        contextSummary: typeof extractionInput.contextSummary === 'string' || typeof extractionInput.contextSummary === 'object'
            ? extractionInput.contextSummary
            : undefined,
        diffSummary: typeof extractionInput.diffSummary === 'string' ? extractionInput.diffSummary : undefined,
        proposedName: typeof extractionInput.proposedName === 'string' ? extractionInput.proposedName : undefined,
        proposedApplyTo: Array.isArray(extractionInput.proposedApplyTo) ? extractionInput.proposedApplyTo.map((entry) => String(entry)) : undefined,
        now: typeof extractionInput.now === 'string' ? extractionInput.now : undefined
    };
}
function createExperienceBehaviorFailure(issue, details) {
    return {
        ok: false,
        issues: [issue],
        evidence: [
            {
                evidenceKind: 'validation',
                summary: 'Experience-loop behavior rejected input.',
                artifactPaths: [],
                details
            }
        ]
    };
}
function readPatternTags(evidenceRecord) {
    const directTags = Array.isArray(evidenceRecord.patternTags) ? evidenceRecord.patternTags : [];
    const detailsTags = Array.isArray(evidenceRecord.details?.patternTags) ? evidenceRecord.details.patternTags : [];
    return [...directTags, ...detailsTags]
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean);
}
function collectEvidenceRefs(evidence) {
    const refs = new Set();
    for (const evidenceRecord of evidence) {
        if (evidenceRecord.evidenceId)
            refs.add(evidenceRecord.evidenceId);
        for (const artifactPath of evidenceRecord.artifactPaths ?? [])
            refs.add(artifactPath);
    }
    return Array.from(refs).sort((leftRef, rightRef) => leftRef.localeCompare(rightRef));
}
function countPatternTags(evidence) {
    const counts = new Map();
    for (const evidenceRecord of evidence) {
        for (const patternTag of collectPatternTags([evidenceRecord])) {
            counts.set(patternTag, (counts.get(patternTag) ?? 0) + 1);
        }
    }
    return counts;
}
function calculateExtractionConfidence(evidence, patternTags, contextSummary, diffSummary) {
    const evidenceScore = Math.min(evidence.length * 0.08, 0.28);
    const patternScore = Math.min(patternTags.length * 0.07, 0.28);
    const contextScore = summarizeContext(contextSummary).length > 0 ? 0.12 : 0;
    const diffScore = typeof diffSummary === 'string' && diffSummary.trim().length > 0 ? 0.1 : 0;
    return clampConfidence(0.28 + evidenceScore + patternScore + contextScore + diffScore);
}
function createSkillDescription(sourceTaskId, patternTags) {
    const patternText = patternTags.length > 0 ? patternTags.join(', ') : 'repeated task evidence';
    return `USE FOR: recurring ATM task patterns involving ${patternText} after task ${sourceTaskId}. DO NOT USE FOR: one-off preferences or proposals without supporting evidence.`;
}
function createProposedSteps(evidence, contextSummary) {
    const steps = [
        'Read the task evidence and identify recurring pattern tags.',
        'Check the affected adapter, plugin, or contract boundary before editing.',
        'Run the smallest deterministic validator that covers the changed surface.'
    ];
    if (summarizeContext(contextSummary).length > 0) {
        steps.push('Carry forward the compact context summary instead of replaying full task history.');
    }
    if (evidence.some((evidenceRecord) => evidenceRecord.evidenceKind === 'review')) {
        steps.push('Attach review findings before promoting the candidate.');
    }
    return steps;
}
function createAmendmentSummary(targetSkillId, patternTags) {
    const patternText = patternTags.length > 0 ? patternTags.join(', ') : 'corrective evidence';
    return `Update ${targetSkillId} to address recurring ${patternText} before the next use.`;
}
function inferSkillName(sourceTaskId, patternTags) {
    if (patternTags.length > 0)
        return `experience-${patternTags[0]}`;
    return `experience-${sourceTaskId}`;
}
function normalizeSkillName(value) {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return normalized || 'experience-candidate';
}
function normalizeApplyTo(value) {
    const normalized = Array.isArray(value)
        ? value.map((entry) => String(entry).trim()).filter(Boolean)
        : [];
    return normalized.length > 0 ? Array.from(new Set(normalized)).sort() : ['**/*'];
}
function summarizeContext(contextSummary) {
    if (typeof contextSummary === 'string')
        return contextSummary.trim();
    if (contextSummary && typeof contextSummary.summary === 'string')
        return contextSummary.summary.trim();
    return '';
}
function clampConfidence(value) {
    return Math.round(Math.max(0, Math.min(0.95, value)) * 100) / 100;
}
function createStableId(prefix, payload) {
    const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
    return `${prefix}-${digest}`;
}
function normalizeRequiredText(value, fieldName) {
    const normalized = String(value ?? '').trim();
    if (!normalized)
        throw new Error(`Experience loop input missing ${fieldName}.`);
    return normalized;
}
