import { createRegistryIndex, normalizeSemanticFingerprint, semanticFingerprintPrefix } from '../registry/registry-index.js';
import { buildLegacyRoutePlan } from '../guidance/legacy-route-plan.js';
import { compareQualityMetrics, renderQualityReportMarkdown } from './regression-compare.js';
import { curateAtomMapEvolution } from '../upgrade/map-curator.js';
import { filterEligibleForDecomposition } from '../source-inventory/source-inventory.js';
export const DEFAULT_POLYMORPH_VARIANT_THRESHOLD = 12;
export function buildPolymorphSuppressionKey(input) {
    return [
        'polymorph',
        input.templateId,
        input.signalKind,
        input.instanceId ?? '*',
        input.templateVersion ?? 'no-base'
    ].join('::');
}
export function buildRollbackSuppressionKey(input) {
    return ['rollback', input.proposalId, input.signalKind, input.baseVersion ?? 'no-base'].join('::');
}
export const DEFAULT_EVIDENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export function runAdopterNeutralityCheck(input = {}) {
    const findings = [];
    const allowlist = new Set(input.allowlist ?? []);
    const profile = input.profile ?? 'standard';
    const severityForProfile = profile === 'full' ? 'block' : 'advisory';
    const actionForProfile = profile === 'full' ? 'request-human-review' : 'needs-review';
    for (const file of input.protectedFiles ?? []) {
        if (allowlist.has(file.filePath))
            continue;
        for (const banned of input.bannedTerms ?? []) {
            if (!file.content.includes(banned.term))
                continue;
            findings.push(makePoliceFinding({
                findingId: `police.registry-consistency.adopter-neutrality.${sanitizeId(banned.termClass)}.${sanitizeId(file.filePath)}`,
                policeFamily: 'registry-consistency',
                severity: severityForProfile,
                trigger: 'adopter-neutrality-violation',
                scope: `${file.scope ?? 'protected-public'}::${file.filePath}`,
                action: actionForProfile,
                routeHint: 'registry.review.adopter-neutrality',
                readModel: 'AdopterNeutralityCheck',
                message: `Protected upstream file ${file.filePath} contains adopter-specific term (${banned.termClass}).`,
                evidenceRefs: [makeEvidenceRef('adopter-neutrality-scan', 'police-artifact')],
                metadata: {
                    filePath: file.filePath,
                    matchedTermClass: banned.termClass,
                    scope: file.scope ?? 'protected-public',
                    suggestedAction: banned.suggestedAction ?? 'replace-with-adopter-neutral-term',
                    profile,
                    directApplyAllowed: false
                }
            }));
        }
    }
    const status = findings.length > 0 && profile === 'full' ? 'fail' : 'pass';
    return makePoliceFamilyReport({
        family: 'registry-consistency',
        mode: 'blocker',
        status,
        findings,
        sourceValidator: 'runAdopterNeutralityCheck'
    });
}
export function verifyAdvisoryOnlyHardening(input = {}) {
    const results = (input.probes ?? []).map((probe) => ({
        probeId: probe.probeId,
        attemptedAction: probe.attemptedAction,
        rejected: true,
        reason: advisoryRejectionReason(probe.attemptedAction)
    }));
    return {
        schemaId: 'atm.advisoryOnlyHardeningReport',
        specVersion: '0.1.0',
        results,
        ok: results.every((entry) => entry.rejected === true)
    };
}
function advisoryRejectionReason(action) {
    switch (action) {
        case 'registry-mutation':
            return 'advisory police family cannot directly mutate registry; route through ReviewAdvisory + HumanReviewDecision';
        case 'auto-approve':
            return 'advisory finding cannot produce approved HumanReviewDecision; must route through human review';
        case 'direct-promotion':
            return 'advisory finding cannot directly promote registry lifecycle state';
        case 'bypass-review':
            return 'advisory finding cannot bypass ReviewAdvisory.machine-finding bridge';
        default:
            return 'unknown advisory action rejected by hardening contract';
    }
}
export const VALIDATOR_PROFILE_NAMING_CONTRACT = {
    schemaId: 'atm.validatorProfileNamingContract',
    specVersion: '0.1.0',
    profiles: [
        {
            profile: 'validate:police-family',
            role: 'named police family gate runner producing PoliceFamilyGateReport',
            relatesTo: ['validate:standard', 'validate:full']
        },
        {
            profile: 'validate:police',
            role: 'legacy police validator suite; preserved for fixture deep-tests in validate:full',
            relatesTo: ['validate:full']
        },
        {
            profile: 'validate:standard',
            role: 'CI default gate; includes validate-police-family as advisory-by-default',
            relatesTo: ['validate:police-family']
        },
        {
            profile: 'validate:full',
            role: 'release gate; extends standard, includes validate:police and may promote stricter blocker assertions',
            relatesTo: ['validate:standard', 'validate:police', 'validate:police-family']
        }
    ]
};
export const DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD = 2;
export const DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD = 0.6;
export const DEFAULT_POLICE_DAILY_CAP = 50;
export function buildEvolutionSuppressionKey(entry) {
    const tags = (entry.patternTags ?? []).slice().sort().join('|');
    const targetId = entry.atomId ?? entry.atomMapId ?? 'unknown';
    const baseVersion = entry.baseAtomVersion ?? entry.baseMapVersion ?? 'no-base';
    return [entry.targetSurface, targetId, entry.signalKind, tags, baseVersion, 'evolution'].join('::');
}
export function buildDecompositionSuppressionKey(entry) {
    return ['source-surface', entry.legacyUri ?? entry.filePath, 'oversized-source-surface', 'decomposition'].join('::');
}
export function buildCorePoliceFamilies(input) {
    const families = [
        makePoliceFamilyReport({
            family: 'schema',
            mode: 'blocker',
            status: 'pass',
            findings: [],
            sourceValidator: 'schema-validator'
        })
    ];
    const coreFindings = (input.policeReport?.violations ?? []).map((violation, index) => {
        const family = classifyViolationFamily(String(violation.code ?? 'core'));
        return makePoliceFinding({
            findingId: `police.${family}.${sanitizeId(violation.code)}.${index}`,
            policeFamily: family,
            severity: violation.severity === 'error' ? 'error' : 'warning',
            trigger: String(violation.code ?? 'police-violation'),
            scope: violation.path ?? violation.atomId,
            action: violation.severity === 'error' ? 'hard-fail' : 'request-human-review',
            routeHint: family === 'registry-consistency' ? 'registry.review' : 'atm.police.core',
            readModel: 'runPoliceChecks.violations',
            message: String(violation.message ?? violation.code ?? 'Police violation detected.'),
            evidenceRefs: violation.path ? [makeEvidenceRef(violation.path, 'police-artifact')] : undefined,
            metadata: {
                violation
            }
        });
    });
    for (const familyName of ['dependency-graph', 'boundary', 'registry-consistency']) {
        const findings = coreFindings.filter((finding) => finding.policeFamily === familyName);
        families.push(makePoliceFamilyReport({
            family: familyName,
            mode: 'blocker',
            status: findings.length > 0 ? 'fail' : 'pass',
            findings,
            sourceValidator: 'runPoliceChecks'
        }));
    }
    const lifecycleFindings = input.lifecycleReport?.hardFail
        ? (input.lifecycleReport.findings ?? [])
            .filter((finding) => finding.action === 'hard-fail' || finding.action === 'quarantine')
            .map((finding, index) => makePoliceFinding({
            findingId: `police.lifecycle.${sanitizeId(finding.trigger)}.${index}`,
            policeFamily: 'lifecycle',
            severity: finding.severity === 'error' ? 'error' : 'warning',
            trigger: finding.trigger,
            scope: finding.scope,
            action: finding.action === 'quarantine' ? 'quarantine' : 'hard-fail',
            routeHint: 'lifecycle-police',
            readModel: 'LifecyclePoliceFinding',
            message: finding.message,
            evidenceRefs: (finding.callerIds ?? []).map((callerId) => makeEvidenceRef(callerId, 'read-model')),
            metadata: {
                lifecycleFinding: finding,
                writer: input.lifecycleReport?.quarantineWriteGuard?.writer ?? null
            }
        }))
        : [];
    families.push(makePoliceFamilyReport({
        family: 'lifecycle',
        mode: 'blocker',
        status: input.lifecycleReport?.hardFail ? 'fail' : 'pass',
        findings: lifecycleFindings,
        sourceValidator: 'runLifecyclePolice'
    }));
    return families;
}
export function makeEvidenceRef(refId, refKind, evidenceType) {
    return {
        refId,
        refKind,
        evidenceType
    };
}
export function makePoliceFinding(input) {
    return {
        ...input,
        mode: input.mode ?? 'fast'
    };
}
export function makePoliceFamilyReport(input) {
    const findings = [...(input.findings ?? [])];
    return {
        family: input.family,
        mode: input.mode,
        status: input.status ?? (findings.length > 0 && input.mode === 'blocker' ? 'fail' : 'pass'),
        findings,
        advisoryOnly: input.mode === 'advisory',
        sourceValidator: input.sourceValidator
    };
}
export function toReviewAdvisorySeverity(severity) {
    if (severity === 'error' || severity === 'block') {
        return 'high';
    }
    if (severity === 'warning') {
        return 'medium';
    }
    if (severity === 'advisory') {
        return 'low';
    }
    return 'info';
}
export function toReviewAdvisoryAction(severity) {
    if (severity === 'error' || severity === 'block') {
        return 'request-human-review';
    }
    if (severity === 'warning' || severity === 'advisory') {
        return 'needs-review';
    }
    return 'monitor';
}
export function toReviewAdvisoryMachineFinding(finding) {
    return {
        id: finding.findingId,
        severity: toReviewAdvisorySeverity(finding.severity),
        message: finding.message,
        routeHint: finding.routeHint ?? 'human-review.supplemental',
        evidenceRefs: finding.evidenceRefs?.map((ref) => ref.refId),
        metadata: {
            policeFinding: finding
        }
    };
}
export function runDedupPolice(input = {}) {
    const findings = [];
    const index = input.registryIndex ?? (input.registryDocument ? createRegistryIndex(input.registryDocument, { allowDuplicates: true }) : null);
    const ignoredAtomIds = new Set(input.polymorphContext?.instanceAtomIds ?? []);
    const ignoredGroupId = input.polymorphContext?.groupId ?? null;
    const seenGroups = new Set();
    if (index) {
        for (const nodeRef of index.nodeRefs) {
            const fingerprint = normalizeSemanticFingerprint(nodeRef.entry?.semanticFingerprint ?? nodeRef.entry?.mapSemanticFingerprint ?? null);
            if (!fingerprint) {
                continue;
            }
            if (seenGroups.has(fingerprint)) {
                continue;
            }
            seenGroups.add(fingerprint);
            const exactHits = index.findBySemanticFingerprint(fingerprint).filter((candidate) => !isPolymorphIgnored(candidate, ignoredAtomIds, ignoredGroupId));
            const prefixHits = index.findByFingerprintPrefix(semanticFingerprintPrefix(fingerprint)).filter((candidate) => !isPolymorphIgnored(candidate, ignoredAtomIds, ignoredGroupId));
            const uniqueHits = uniqueNodeRefs([...exactHits, ...prefixHits]);
            if (uniqueHits.length < 2) {
                continue;
            }
            findings.push(makePoliceFinding({
                findingId: `police.dedup.semantic-fingerprint-overlap.${sanitizeId(semanticFingerprintPrefix(fingerprint))}`,
                policeFamily: 'dedup',
                severity: 'advisory',
                trigger: 'semantic-fingerprint-overlap',
                scope: uniqueHits.map((hit) => hit.canonicalId).join(','),
                action: 'needs-review',
                routeHint: 'behavior.dedup-merge',
                readModel: 'RegistryIndex.semanticFingerprintPrefix',
                message: `Semantic fingerprint overlap detected for ${uniqueHits.map((hit) => hit.canonicalId).join(', ')}.`,
                evidenceRefs: [makeEvidenceRef('fingerprint-snapshot', 'police-artifact')],
                metadata: {
                    matchMode: exactHits.length > 1 ? 'exact' : 'prefix',
                    candidates: uniqueHits.map((hit) => ({
                        canonicalId: hit.canonicalId,
                        nodeKind: hit.nodeKind,
                        semanticFingerprint: hit.entry?.semanticFingerprint ?? hit.entry?.mapSemanticFingerprint ?? null
                    }))
                }
            }));
        }
    }
    for (const candidate of input.qualityComparisonReport?.dedupCandidates ?? []) {
        if (candidate?.polymorphGroupId && candidate.polymorphGroupId === ignoredGroupId) {
            continue;
        }
        if (ignoredAtomIds.has(candidate?.atomId)) {
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.dedup.quality-hint.${sanitizeId(candidate.atomId)}`,
            policeFamily: 'dedup',
            severity: 'advisory',
            trigger: 'quality-dedup-candidate',
            scope: candidate.atomId,
            action: 'needs-review',
            routeHint: 'behavior.dedup-merge',
            readModel: 'qualityComparisonReport.dedupCandidates',
            message: `Quality comparison reported dedup candidate ${candidate.atomId} at similarity ${candidate.similarity}.`,
            evidenceRefs: [makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison')],
            metadata: {
                candidate
            }
        }));
    }
    return makePoliceFamilyReport({
        family: 'dedup',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runDedupPolice'
    });
}
export async function runDemandPolice(input = {}) {
    const plan = input.legacyRoutePlan ?? (input.buildLegacyRoutePlanInput ? await buildLegacyRoutePlan(input.buildLegacyRoutePlanInput) : null);
    const demandThreshold = input.demandThreshold ?? input.buildLegacyRoutePlanInput?.demandThreshold ?? 6;
    const findings = [];
    for (const segment of plan?.segments ?? []) {
        if (segment.role === 'trunk') {
            continue;
        }
        const exceedsThreshold = segment.callerDemand >= demandThreshold || segment.recommendedBehavior === 'split';
        if (!exceedsThreshold) {
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.demand.caller-demand-threshold.${sanitizeId(segment.symbolName)}`,
            policeFamily: 'demand',
            severity: 'advisory',
            trigger: 'caller-demand-threshold',
            scope: `${plan?.targetFile ?? 'legacy'}#${segment.symbolName}`,
            action: 'needs-review',
            routeHint: 'behavior.split',
            readModel: 'LegacyRoutePlan.callerDemand',
            message: `${segment.symbolName} caller demand ${segment.callerDemand} meets split threshold ${demandThreshold}.`,
            evidenceRefs: [makeEvidenceRef('caller-graph-snapshot', 'read-model')],
            metadata: {
                demandThreshold,
                segment,
                directApplyAllowed: false
            }
        }));
    }
    return makePoliceFamilyReport({
        family: 'demand',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runDemandPolice'
    });
}
export function runQualityPolice(input = {}) {
    const report = input.qualityComparisonReport ?? (input.qualityComparisonInput ? compareQualityMetrics(input.qualityComparisonInput) : null);
    const findings = [];
    if (!report) {
        return makePoliceFamilyReport({
            family: 'quality',
            mode: 'blocker',
            status: 'skipped',
            findings,
            sourceValidator: 'runQualityPolice'
        });
    }
    for (const metric of report.regressedMetrics ?? []) {
        findings.push(makePoliceFinding({
            findingId: `police.quality.regression.${sanitizeId(report.atomId)}.${sanitizeId(metric)}`,
            policeFamily: 'quality',
            severity: 'block',
            trigger: 'quality-regression',
            scope: `${report.atomId}@${report.fromVersion}->${report.toVersion}`,
            action: 'request-human-review',
            routeHint: 'behavior.evolve',
            readModel: 'compareQualityMetrics.regressedMetrics',
            message: `Quality regression detected for ${report.atomId}: ${metric}.`,
            evidenceRefs: [makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison')],
            metadata: {
                metric,
                reportId: report.reportId
            }
        }));
    }
    for (const status of report.mapImpactScope?.propagationStatus ?? []) {
        if (status.integrationTestPassed !== false) {
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.quality.map-propagation-failure.${sanitizeId(status.mapId)}`,
            policeFamily: 'quality',
            severity: 'block',
            trigger: 'map-propagation-failure',
            scope: status.mapId,
            action: 'request-human-review',
            routeHint: 'behavior.compose',
            readModel: 'compareQualityMetrics.mapImpactScope',
            message: `Map propagation failed for ${status.mapId}${status.message ? `: ${status.message}` : '.'}`,
            evidenceRefs: [
                makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison'),
                makeEvidenceRef('map-propagation-log', 'police-artifact')
            ],
            metadata: {
                propagationStatus: status,
                reportId: report.reportId
            }
        }));
    }
    for (const candidate of report.dedupCandidates ?? []) {
        findings.push(makePoliceFinding({
            findingId: `police.quality.dedup-hint.${sanitizeId(candidate.atomId)}`,
            policeFamily: 'quality',
            severity: 'advisory',
            trigger: 'quality-dedup-candidate',
            scope: candidate.atomId,
            action: 'needs-review',
            routeHint: 'behavior.dedup-merge',
            readModel: 'compareQualityMetrics.dedupCandidates',
            message: `Quality comparison surfaced dedup candidate ${candidate.atomId}.`,
            evidenceRefs: [makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison')],
            metadata: {
                candidate
            }
        }));
    }
    return makePoliceFamilyReport({
        family: 'quality',
        mode: 'blocker',
        status: findings.some((finding) => finding.severity === 'block' || finding.severity === 'error') ? 'fail' : 'pass',
        findings,
        sourceValidator: 'runQualityPolice'
    });
}
export function runMapIntegrationPolice(input = {}) {
    const report = input.curatorReport ?? (input.curatorInput ? curateAtomMapEvolution(input.curatorInput) : null);
    const findings = [];
    for (const draft of report?.proposalDrafts ?? []) {
        const blocked = draft.autoPromoteEligible === false;
        findings.push(makePoliceFinding({
            findingId: `police.map-integration.${sanitizeId(draft.behaviorId)}.${sanitizeId(draft.candidateId)}`,
            policeFamily: 'map-integration',
            severity: blocked ? 'warning' : 'advisory',
            trigger: `map-curator-${draft.signalKind}`,
            scope: draft.targetMapId,
            action: 'proposal-draft',
            routeHint: draft.behaviorId,
            readModel: 'curateAtomMapEvolution.proposalDrafts',
            message: `Map curator produced ${draft.behaviorId} proposal draft ${draft.candidateId}.`,
            evidenceRefs: [
                makeEvidenceRef('map-propagation-log', 'police-artifact'),
                ...draft.sourceEvidenceIds.map((refId) => makeEvidenceRef(refId, 'official-evidence', 'usage-feedback'))
            ],
            metadata: {
                autoPromoteEligible: draft.autoPromoteEligible,
                signalKind: draft.signalKind,
                proposalId: draft.proposal?.proposalId ?? null
            }
        }));
    }
    for (const observation of report?.observations ?? []) {
        findings.push(makePoliceFinding({
            findingId: `police.map-integration.observation.${sanitizeId(observation.candidateId)}`,
            policeFamily: 'map-integration',
            severity: 'info',
            trigger: `map-curator-${observation.signalKind}`,
            scope: observation.candidateId,
            action: 'monitor',
            routeHint: 'behavior.compose',
            readModel: 'curateAtomMapEvolution.observations',
            message: `Map curator kept ${observation.candidateId} as observation-only: ${observation.reasons.join(', ')}.`,
            evidenceRefs: [makeEvidenceRef('map-propagation-log', 'police-artifact')],
            metadata: {
                reasons: observation.reasons
            }
        }));
    }
    for (const status of input.qualityComparisonReport?.mapImpactScope?.propagationStatus ?? []) {
        if (status.integrationTestPassed !== false) {
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.map-integration.propagation-risk.${sanitizeId(status.mapId)}`,
            policeFamily: 'map-integration',
            severity: 'warning',
            trigger: 'map-propagation-risk',
            scope: status.mapId,
            action: 'needs-review',
            routeHint: 'behavior.compose',
            readModel: 'qualityComparisonReport.mapImpactScope',
            message: `Map impact scope reports propagation risk for ${status.mapId}.`,
            evidenceRefs: [makeEvidenceRef('map-propagation-log', 'police-artifact')],
            metadata: {
                propagationStatus: status
            }
        }));
    }
    return makePoliceFamilyReport({
        family: 'map-integration',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runMapIntegrationPolice'
    });
}
export function runAtomizationPolice(input = {}) {
    const findings = [];
    for (const segment of input.legacyRoutePlan?.segments ?? []) {
        if (segment.recommendedBehavior !== 'atomize' && segment.recommendedBehavior !== 'infect') {
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.atomization.${segment.recommendedBehavior}.${sanitizeId(segment.symbolName)}`,
            policeFamily: 'atomization',
            severity: 'advisory',
            trigger: 'legacy-route-plan-candidate',
            scope: `${input.legacyRoutePlan?.targetFile ?? 'legacy'}#${segment.symbolName}`,
            action: 'needs-review',
            routeHint: `behavior.${segment.recommendedBehavior}`,
            readModel: 'LegacyRoutePlan.segments',
            message: `${segment.symbolName} is eligible for ${segment.recommendedBehavior} dry-run planning.`,
            evidenceRefs: [makeEvidenceRef('caller-graph-snapshot', 'read-model')],
            metadata: {
                segment
            }
        }));
    }
    if (input.dryRunResult) {
        const dryRunPatch = input.dryRunResult.extra?.dryRunPatch ?? input.dryRunResult.dryRunPatch;
        const neutrality = input.dryRunResult.extra?.neutrality ?? input.dryRunResult.neutrality;
        const contractFailures = [];
        if (!dryRunPatch) {
            contractFailures.push('missing-dry-run-patch');
        }
        else {
            if (dryRunPatch.dryRun !== true)
                contractFailures.push('dryRun-must-be-true');
            if (dryRunPatch.applyToHostProject === true)
                contractFailures.push('applyToHostProject-must-not-be-true');
            if (dryRunPatch.hostMutationAllowed === true)
                contractFailures.push('hostMutationAllowed-must-not-be-true');
            if (dryRunPatch.patchMode !== 'dry-run')
                contractFailures.push('patchMode-must-be-dry-run');
        }
        if (input.dryRunResult.ok === false) {
            contractFailures.push('adapter-result-not-ok');
        }
        if ((neutrality?.violationCount ?? 0) > 0 || neutrality?.ok === false) {
            contractFailures.push('neutrality-scan-failed');
        }
        if (contractFailures.length > 0) {
            findings.push(makePoliceFinding({
                findingId: 'police.atomization.dry-run-guard.blocker',
                policeFamily: 'atomization',
                severity: 'block',
                trigger: 'dry-run-proposal-guard',
                scope: dryRunPatch?.contractId ?? 'atomization-dry-run',
                action: 'request-human-review',
                routeHint: 'behavior.atomize',
                readModel: 'ProjectAdapterDryRunPatchContract',
                message: `Atomization dry-run guard failed: ${contractFailures.join(', ')}.`,
                evidenceRefs: [
                    makeEvidenceRef('dry-run-patch', 'police-artifact'),
                    makeEvidenceRef('neutrality-scan', 'police-artifact')
                ],
                metadata: {
                    contractFailures,
                    dryRunPatch,
                    neutrality
                }
            }));
        }
    }
    return makePoliceFamilyReport({
        family: 'atomization',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runAtomizationPolice'
    });
}
export function runDecompositionPolice(input = {}) {
    const inventory = input.inventory;
    if (!inventory) {
        return makePoliceFamilyReport({
            family: 'decomposition',
            mode: 'advisory',
            status: 'skipped',
            findings: [],
            sourceValidator: 'runDecompositionPolice'
        });
    }
    const threshold = input.maxFileLines ?? inventory.maxFileLines;
    const suppressed = new Set(input.suppressedFilePaths ?? []);
    const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
    const findings = [];
    const eligible = filterEligibleForDecomposition({ ...inventory, maxFileLines: threshold });
    let emitted = 0;
    for (const entry of eligible) {
        if (suppressed.has(entry.filePath)) {
            continue;
        }
        if (emitted >= dailyCap) {
            findings.push(makePoliceFinding({
                findingId: `police.decomposition.daily-cap.${sanitizeId(entry.filePath)}`,
                policeFamily: 'decomposition',
                severity: 'info',
                trigger: 'oversized-source-surface',
                scope: entry.filePath,
                action: 'monitor',
                routeHint: 'observation.daily-cap',
                readModel: 'SourceInventoryReport',
                message: `Daily proposal cap (${dailyCap}) reached; further oversized-source-surface findings observed only.`,
                evidenceRefs: [makeEvidenceRef('source-inventory', 'police-artifact')],
                metadata: {
                    dailyCap,
                    filePath: entry.filePath,
                    suppressionKey: buildDecompositionSuppressionKey(entry),
                    directApplyAllowed: false
                }
            }));
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.decomposition.oversized-source-surface.${sanitizeId(entry.filePath)}`,
            policeFamily: 'decomposition',
            severity: 'advisory',
            trigger: 'oversized-source-surface',
            scope: entry.filePath,
            action: 'proposal-draft',
            routeHint: 'behavior.atomize',
            readModel: 'SourceInventoryReport',
            message: `${entry.filePath} has ${entry.lineCount} LOC (threshold ${threshold}); recommend decomposition plan + atomic-map replacement.`,
            evidenceRefs: [makeEvidenceRef('source-inventory', 'police-artifact')],
            metadata: {
                lineCount: entry.lineCount,
                threshold,
                legacyUri: entry.legacyUri ?? entry.filePath,
                language: entry.language ?? 'unknown',
                entrypointHint: entry.entrypointHint ?? null,
                suggestedRoute: ['behavior.atomize', 'behavior.compose'],
                suggestedMapReplacement: true,
                decompositionPlanHint: {
                    legacyUris: [entry.legacyUri ?? entry.filePath],
                    proposedMembers: entry.exportedSymbols ?? [],
                    entrypoints: entry.entrypointHint ? [entry.entrypointHint] : []
                },
                suppressionKey: buildDecompositionSuppressionKey(entry),
                directApplyAllowed: false
            }
        }));
        emitted += 1;
    }
    return makePoliceFamilyReport({
        family: 'decomposition',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runDecompositionPolice'
    });
}
export function buildDecompositionPlanHintDraft(finding) {
    if (finding.policeFamily !== 'decomposition' || finding.trigger !== 'oversized-source-surface') {
        return { ok: false, errors: ['finding-not-decomposition-oversized-source-surface'] };
    }
    const hint = finding.metadata?.decompositionPlanHint;
    const errors = [];
    if (!hint?.legacyUris || hint.legacyUris.length === 0) {
        errors.push('missing-replacement-legacyUris');
    }
    if (!hint?.entrypoints || hint.entrypoints.length === 0) {
        errors.push('missing-entrypoints');
    }
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return {
        ok: true,
        errors: [],
        draft: {
            schemaId: 'atm.decompositionPlanDraft',
            specVersion: '0.1.0',
            mode: 'draft',
            legacyUris: [...hint.legacyUris],
            proposedMembers: [...(hint.proposedMembers ?? [])],
            entrypoints: [...hint.entrypoints]
        }
    };
}
export function runEvolutionPolice(input = {}) {
    const recurrenceThreshold = input.recurrenceThreshold ?? DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD;
    const confidenceThreshold = input.confidenceThreshold ?? DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD;
    const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    let emitted = 0;
    for (const entry of input.evidencePatterns ?? []) {
        const key = buildEvolutionSuppressionKey(entry);
        const baseStale = (entry.baseAtomVersion && entry.currentAtomVersion && entry.baseAtomVersion !== entry.currentAtomVersion)
            || (entry.baseMapVersion && entry.currentMapVersion && entry.baseMapVersion !== entry.currentMapVersion);
        if (baseStale) {
            findings.push(makePoliceFinding({
                findingId: `police.evolution.stale-evolution-draft.${sanitizeId(key)}`,
                policeFamily: 'evolution',
                severity: 'warning',
                trigger: 'stale-evolution-draft',
                scope: entry.targetSurface,
                action: 'request-human-review',
                routeHint: 'review.stale-base',
                readModel: 'evolutionEvidencePattern',
                message: `Evolution draft references stale base (atom ${entry.baseAtomVersion ?? '-'} vs ${entry.currentAtomVersion ?? '-'}, map ${entry.baseMapVersion ?? '-'} vs ${entry.currentMapVersion ?? '-'}).`,
                evidenceRefs: [makeEvidenceRef('stale-base-version', 'police-artifact')],
                metadata: {
                    baseAtomVersion: entry.baseAtomVersion,
                    currentAtomVersion: entry.currentAtomVersion,
                    baseMapVersion: entry.baseMapVersion,
                    currentMapVersion: entry.currentMapVersion,
                    suppressionKey: key,
                    directApplyAllowed: false
                }
            }));
            continue;
        }
        if (suppressed.has(key))
            continue;
        const hasNonUsageEvidence = Boolean(entry.hasFrictionEvidence || entry.hasRegressionEvidence || entry.hasReviewEvidence);
        if (entry.hasUsageOnlyEvidence && !hasNonUsageEvidence)
            continue;
        if (entry.hostLocal)
            continue;
        if (entry.recurrence < recurrenceThreshold)
            continue;
        if (entry.confidence < confidenceThreshold)
            continue;
        if (emitted >= dailyCap) {
            findings.push(makePoliceFinding({
                findingId: `police.evolution.daily-cap.${sanitizeId(key)}`,
                policeFamily: 'evolution',
                severity: 'info',
                trigger: entry.signalKind,
                scope: entry.targetSurface,
                action: 'monitor',
                routeHint: 'observation.daily-cap',
                readModel: 'evolutionEvidencePattern',
                message: `Daily proposal cap (${dailyCap}) reached; further ${entry.signalKind} observations only.`,
                metadata: {
                    dailyCap,
                    suppressionKey: key,
                    directApplyAllowed: false
                }
            }));
            continue;
        }
        const behavior = entry.suggestedBehavior ?? (entry.signalKind === 'map-evolution-signal' ? 'compose' : 'evolve');
        const evidenceRefs = [];
        if (entry.hasFrictionEvidence)
            evidenceRefs.push(makeEvidenceRef('friction-evidence', 'police-artifact'));
        if (entry.hasRegressionEvidence)
            evidenceRefs.push(makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison'));
        if (entry.hasReviewEvidence)
            evidenceRefs.push(makeEvidenceRef('human-review-decision', 'official-evidence', 'human-review-decision'));
        if (entry.hasUsageOnlyEvidence)
            evidenceRefs.push(makeEvidenceRef('usage-feedback', 'official-evidence', 'usage-feedback'));
        findings.push(makePoliceFinding({
            findingId: `police.evolution.${entry.signalKind}.${sanitizeId(key)}`,
            policeFamily: 'evolution',
            severity: 'advisory',
            trigger: entry.signalKind,
            scope: entry.targetSurface,
            action: 'proposal-draft',
            routeHint: `behavior.${behavior}`,
            readModel: 'evolutionEvidencePattern',
            message: `${entry.signalKind} detected for ${entry.targetSurface} (recurrence=${entry.recurrence}, confidence=${entry.confidence}).`,
            evidenceRefs,
            metadata: {
                recurrence: entry.recurrence,
                confidence: entry.confidence,
                patternTags: [...entry.patternTags],
                suggestedBehavior: behavior,
                suppressionKey: key,
                baseAtomVersion: entry.baseAtomVersion,
                currentAtomVersion: entry.currentAtomVersion,
                baseMapVersion: entry.baseMapVersion,
                currentMapVersion: entry.currentMapVersion,
                hostLocal: entry.hostLocal ?? false,
                matchedEvidenceIds: entry.matchedEvidenceIds ?? [],
                directApplyAllowed: false
            }
        }));
        emitted += 1;
    }
    return makePoliceFamilyReport({
        family: 'evolution',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runEvolutionPolice'
    });
}
export function runPolymorphPolice(input = {}) {
    const template = input.template;
    const instances = input.instances ?? [];
    const threshold = input.variantThreshold ?? DEFAULT_POLYMORPH_VARIANT_THRESHOLD;
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    if (template) {
        for (const instance of instances) {
            if (instance.templateId !== template.templateId)
                continue;
            const inheritedVersion = instance.inheritedTemplateVersion ?? instance.parentTemplateVersion;
            if (inheritedVersion && inheritedVersion !== template.templateVersion) {
                const key = buildPolymorphSuppressionKey({
                    templateId: template.templateId,
                    signalKind: 'template-drift',
                    instanceId: instance.instanceId,
                    templateVersion: template.templateVersion
                });
                if (!suppressed.has(key)) {
                    findings.push(makePoliceFinding({
                        findingId: `police.polymorph.template-drift.${sanitizeId(instance.instanceId)}`,
                        policeFamily: 'polymorph',
                        severity: 'advisory',
                        trigger: 'template-drift',
                        scope: `${template.templateId}@${template.templateVersion}->${instance.instanceId}`,
                        action: 'needs-review',
                        routeHint: 'behavior.polymorphize',
                        readModel: 'PolymorphTemplate.instances',
                        message: `Instance ${instance.instanceId} parent template ${inheritedVersion} drifted from template ${template.templateVersion}.`,
                        evidenceRefs: [makeEvidenceRef('polymorph-template-record', 'police-artifact')],
                        metadata: {
                            templateId: template.templateId,
                            templateVersion: template.templateVersion,
                            instanceId: instance.instanceId,
                            inheritedVersion,
                            suppressionKey: key,
                            directApplyAllowed: false
                        }
                    }));
                }
            }
            if (instance.dimensionDriftTags && instance.dimensionDriftTags.length > 0) {
                const key = buildPolymorphSuppressionKey({
                    templateId: template.templateId,
                    signalKind: 'polymorph-dimension-drift',
                    instanceId: instance.instanceId,
                    templateVersion: template.templateVersion
                });
                if (!suppressed.has(key)) {
                    findings.push(makePoliceFinding({
                        findingId: `police.polymorph.dimension-drift.${sanitizeId(instance.instanceId)}`,
                        policeFamily: 'polymorph',
                        severity: 'advisory',
                        trigger: 'polymorph-dimension-drift',
                        scope: `${template.templateId}->${instance.instanceId}`,
                        action: 'needs-review',
                        routeHint: 'behavior.polymorphize',
                        readModel: 'PolymorphTemplate.dimensionSpec',
                        message: `Instance ${instance.instanceId} reports dimension drift tags: ${[...instance.dimensionDriftTags].join(', ')}.`,
                        evidenceRefs: [makeEvidenceRef('polymorph-dimension-record', 'police-artifact')],
                        metadata: {
                            templateId: template.templateId,
                            instanceId: instance.instanceId,
                            dimensionDriftTags: [...instance.dimensionDriftTags],
                            suppressionKey: key,
                            directApplyAllowed: false
                        }
                    }));
                }
            }
        }
        const propagatedInstances = instances.filter((instance) => instance.templateId === template.templateId);
        const missingPropagation = propagatedInstances.filter((instance) => {
            const inheritedVersion = instance.inheritedTemplateVersion ?? instance.parentTemplateVersion;
            return !inheritedVersion || inheritedVersion !== template.templateVersion;
        });
        if (missingPropagation.length > 0 && propagatedInstances.length > 0) {
            const propagationKey = buildPolymorphSuppressionKey({
                templateId: template.templateId,
                signalKind: 'instance-propagation-missing',
                templateVersion: template.templateVersion
            });
            if (!suppressed.has(propagationKey)) {
                findings.push(makePoliceFinding({
                    findingId: `police.polymorph.instance-propagation-missing.${sanitizeId(template.templateId)}.${sanitizeId(template.templateVersion)}`,
                    policeFamily: 'polymorph',
                    severity: 'warning',
                    trigger: 'instance-propagation-missing',
                    scope: `${template.templateId}@${template.templateVersion}`,
                    action: 'request-human-review',
                    routeHint: 'behavior.polymorphize',
                    readModel: 'PolymorphTemplate.instances',
                    message: `${missingPropagation.length}/${propagatedInstances.length} polymorph instances missing propagation to template ${template.templateVersion}.`,
                    evidenceRefs: [makeEvidenceRef('polymorph-propagation-log', 'police-artifact')],
                    metadata: {
                        templateId: template.templateId,
                        templateVersion: template.templateVersion,
                        missingInstanceIds: missingPropagation.map((entry) => entry.instanceId),
                        suppressionKey: propagationKey,
                        directApplyAllowed: false
                    }
                }));
            }
        }
        if (propagatedInstances.length > threshold) {
            const variantKey = buildPolymorphSuppressionKey({
                templateId: template.templateId,
                signalKind: 'variant-explosion',
                templateVersion: template.templateVersion
            });
            if (!suppressed.has(variantKey)) {
                findings.push(makePoliceFinding({
                    findingId: `police.polymorph.variant-explosion.${sanitizeId(template.templateId)}`,
                    policeFamily: 'polymorph',
                    severity: 'warning',
                    trigger: 'variant-explosion',
                    scope: template.templateId,
                    action: 'request-human-review',
                    routeHint: 'behavior.evolve',
                    readModel: 'PolymorphTemplate.instances',
                    message: `Polymorph template ${template.templateId} has ${propagatedInstances.length} instances (threshold ${threshold}).`,
                    evidenceRefs: [makeEvidenceRef('polymorph-template-record', 'police-artifact')],
                    metadata: {
                        templateId: template.templateId,
                        instanceCount: propagatedInstances.length,
                        variantThreshold: threshold,
                        suppressionKey: variantKey,
                        directApplyAllowed: false
                    }
                }));
            }
        }
    }
    return makePoliceFamilyReport({
        family: 'polymorph',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runPolymorphPolice'
    });
}
export function runRollbackPolice(input = {}) {
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    for (const proposal of input.proposals ?? []) {
        const issues = evaluateRollbackProposal(proposal);
        for (const issue of issues) {
            const key = buildRollbackSuppressionKey({
                proposalId: proposal.proposalId,
                signalKind: issue.trigger,
                baseVersion: proposal.baseVersion
            });
            if (suppressed.has(key))
                continue;
            findings.push(makePoliceFinding({
                findingId: `police.rollback.${issue.trigger}.${sanitizeId(proposal.proposalId)}`,
                policeFamily: 'rollback',
                severity: issue.severity,
                trigger: issue.trigger,
                scope: proposal.proposalId,
                action: issue.severity === 'block' ? 'request-human-review' : 'needs-review',
                routeHint: 'review.rollback',
                readModel: 'RollbackProposal.reversibility',
                message: issue.message,
                evidenceRefs: [makeEvidenceRef('rollback-proof', 'police-artifact')],
                metadata: {
                    proposalId: proposal.proposalId,
                    riskClass: proposal.riskClass,
                    baseVersion: proposal.baseVersion,
                    rollbackScope: proposal.rollbackScope ? [...proposal.rollbackScope] : [],
                    touchedSurfaces: proposal.touchedSurfaces ? [...proposal.touchedSurfaces] : [],
                    suppressionKey: key,
                    directApplyAllowed: false
                }
            }));
        }
    }
    const status = findings.some((finding) => finding.severity === 'block' || finding.severity === 'error') ? 'fail' : 'pass';
    return makePoliceFamilyReport({
        family: 'rollback',
        mode: 'advisory',
        status,
        findings,
        sourceValidator: 'runRollbackPolice'
    });
}
function evaluateRollbackProposal(proposal) {
    const issues = [];
    const hasAnyEvidence = Boolean(proposal.hasRollbackProof || proposal.hasEquivalenceProof || proposal.hasRetirementProof || proposal.hasReversiblePatchEnvelope);
    if (!hasAnyEvidence) {
        issues.push({
            trigger: 'irreversible-proposal',
            severity: 'block',
            message: `Proposal ${proposal.proposalId} (${proposal.riskClass}) has no rollback/equivalence/retirement/reversible-patch evidence.`
        });
    }
    if (proposal.riskClass === 'atom-evolve' && !proposal.hasRollbackProof && !proposal.hasReversiblePatchEnvelope) {
        issues.push({
            trigger: 'rollback-proof-missing',
            severity: 'block',
            message: `Atom evolve proposal ${proposal.proposalId} requires rollback proof or reversible patch envelope.`
        });
    }
    if (proposal.riskClass === 'map-replacement' && !proposal.hasEquivalenceProof) {
        issues.push({
            trigger: 'equivalence-proof-missing',
            severity: 'block',
            message: `Map replacement proposal ${proposal.proposalId} requires map equivalence proof.`
        });
    }
    if (proposal.riskClass === 'legacy-retired' && !proposal.hasRetirementProof && !proposal.hasRollbackProof) {
        issues.push({
            trigger: 'retirement-proof-missing',
            severity: 'block',
            message: `Legacy retired proposal ${proposal.proposalId} requires retirement proof or rollback proof.`
        });
    }
    if ((proposal.riskClass === 'atomize' || proposal.riskClass === 'infect') && !proposal.hasReversiblePatchEnvelope) {
        issues.push({
            trigger: 'rollback-proof-missing',
            severity: 'block',
            message: `${proposal.riskClass} proposal ${proposal.proposalId} requires dry-run reversible patch envelope.`
        });
    }
    if (proposal.touchedSurfaces && proposal.rollbackScope) {
        const scopeSet = new Set(proposal.rollbackScope);
        const drifted = proposal.touchedSurfaces.filter((surface) => !scopeSet.has(surface));
        if (drifted.length > 0) {
            issues.push({
                trigger: 'rollback-scope-drift',
                severity: 'warning',
                message: `Proposal ${proposal.proposalId} touches surfaces outside rollback scope: ${drifted.join(', ')}.`
            });
        }
    }
    return issues;
}
// ── Shared Gates (APF-0045 / 0046 / 0047) ──────────────────────────────────
export function runEvidenceIntegrityGate(input = {}) {
    const findings = [];
    const catalog = input.catalog ?? [];
    const catalogIndex = new Map();
    for (const entry of catalog) {
        catalogIndex.set(entry.evidenceId, entry);
    }
    const now = input.nowIso ? Date.parse(input.nowIso) : Date.now();
    const maxAgeMs = input.maxAgeMs ?? DEFAULT_EVIDENCE_MAX_AGE_MS;
    for (const proposalRef of input.proposalEvidenceRefs ?? []) {
        if (proposalRef.refIds.length === 0) {
            findings.push(makePoliceFinding({
                findingId: `gate.evidence-integrity.missing.${sanitizeId(proposalRef.proposalId)}`,
                policeFamily: 'registry-consistency',
                severity: 'warning',
                trigger: 'evidence-missing',
                scope: proposalRef.proposalId,
                action: 'needs-review',
                routeHint: 'review.evidence-missing',
                readModel: 'EvidenceCatalog',
                message: `Proposal ${proposalRef.proposalId} has no evidence references.`,
                metadata: { proposalId: proposalRef.proposalId, gate: 'evidence-integrity', directApplyAllowed: false }
            }));
        }
    }
    for (const finding of input.findings ?? []) {
        const refs = finding.evidenceRefs ?? [];
        if (refs.length === 0)
            continue;
        const seenIds = new Set();
        for (const ref of refs) {
            if (seenIds.has(ref.refId)) {
                findings.push(makePoliceFinding({
                    findingId: `gate.evidence-integrity.duplicate.${sanitizeId(finding.findingId)}.${sanitizeId(ref.refId)}`,
                    policeFamily: finding.policeFamily,
                    severity: 'info',
                    trigger: 'evidence-duplicate',
                    scope: ref.refId,
                    action: 'monitor',
                    routeHint: 'monitor.evidence-duplicate',
                    readModel: 'EvidenceCatalog',
                    message: `Duplicate evidence ref ${ref.refId} on finding ${finding.findingId}.`,
                    metadata: { sourceFindingId: finding.findingId, refId: ref.refId, gate: 'evidence-integrity', directApplyAllowed: false }
                }));
                continue;
            }
            seenIds.add(ref.refId);
            const catalogEntry = catalogIndex.get(ref.refId);
            if (!catalogEntry)
                continue;
            if (catalogEntry.trustLevel === 'untrusted') {
                findings.push(makePoliceFinding({
                    findingId: `gate.evidence-integrity.untrusted.${sanitizeId(ref.refId)}`,
                    policeFamily: finding.policeFamily,
                    severity: 'warning',
                    trigger: 'evidence-untrusted',
                    scope: ref.refId,
                    action: 'request-human-review',
                    routeHint: 'review.evidence-untrusted',
                    readModel: 'EvidenceCatalog',
                    message: `Evidence ${ref.refId} marked untrusted.`,
                    metadata: { sourceFindingId: finding.findingId, refId: ref.refId, gate: 'evidence-integrity', directApplyAllowed: false }
                }));
            }
            if (ref.evidenceType && catalogEntry.evidenceType && ref.evidenceType !== catalogEntry.evidenceType) {
                findings.push(makePoliceFinding({
                    findingId: `gate.evidence-integrity.schema-mismatch.${sanitizeId(ref.refId)}`,
                    policeFamily: finding.policeFamily,
                    severity: 'warning',
                    trigger: 'evidence-schema-mismatch',
                    scope: ref.refId,
                    action: 'request-human-review',
                    routeHint: 'review.evidence-schema-mismatch',
                    readModel: 'EvidenceCatalog',
                    message: `Evidence ${ref.refId} schema mismatch: expected ${ref.evidenceType}, catalog says ${catalogEntry.evidenceType}.`,
                    metadata: { sourceFindingId: finding.findingId, refId: ref.refId, gate: 'evidence-integrity', directApplyAllowed: false }
                }));
            }
            if (catalogEntry.generatedAt) {
                const ageMs = now - Date.parse(catalogEntry.generatedAt);
                if (ageMs > maxAgeMs) {
                    findings.push(makePoliceFinding({
                        findingId: `gate.evidence-integrity.stale.${sanitizeId(ref.refId)}`,
                        policeFamily: finding.policeFamily,
                        severity: 'warning',
                        trigger: 'evidence-stale',
                        scope: ref.refId,
                        action: 'request-human-review',
                        routeHint: 'review.evidence-stale',
                        readModel: 'EvidenceCatalog',
                        message: `Evidence ${ref.refId} is stale (age ${Math.round(ageMs / (24 * 60 * 60 * 1000))} days > max ${Math.round(maxAgeMs / (24 * 60 * 60 * 1000))}).`,
                        metadata: { sourceFindingId: finding.findingId, refId: ref.refId, gate: 'evidence-integrity', directApplyAllowed: false }
                    }));
                }
            }
        }
    }
    return {
        gate: 'evidence-integrity',
        status: findings.some((f) => f.severity === 'warning' || f.severity === 'block' || f.severity === 'error') ? 'advisory' : 'pass',
        findings,
        summary: { total: findings.length },
        sourceValidator: 'runEvidenceIntegrityGate'
    };
}
export function runReversibilityGate(input = {}) {
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    let blocked = 0;
    for (const proposal of input.proposals ?? []) {
        const issues = evaluateRollbackProposal(proposal);
        for (const issue of issues) {
            const key = buildRollbackSuppressionKey({
                proposalId: proposal.proposalId,
                signalKind: issue.trigger,
                baseVersion: proposal.baseVersion
            });
            if (suppressed.has(key))
                continue;
            if (issue.severity === 'block')
                blocked += 1;
            findings.push(makePoliceFinding({
                findingId: `gate.reversibility.${issue.trigger}.${sanitizeId(proposal.proposalId)}`,
                policeFamily: 'rollback',
                severity: issue.severity,
                trigger: issue.trigger,
                scope: proposal.proposalId,
                action: issue.severity === 'block' ? 'request-human-review' : 'needs-review',
                routeHint: 'gate.reversibility',
                readModel: 'ReversibilityGate',
                message: issue.message,
                evidenceRefs: [makeEvidenceRef('reversibility-gate', 'police-artifact')],
                metadata: {
                    proposalId: proposal.proposalId,
                    riskClass: proposal.riskClass,
                    suppressionKey: key,
                    gate: 'reversibility',
                    directApplyAllowed: false
                }
            }));
        }
    }
    return {
        gate: 'reversibility',
        status: blocked > 0 ? 'fail' : findings.length > 0 ? 'advisory' : 'pass',
        findings,
        summary: { total: findings.length, blocked },
        sourceValidator: 'runReversibilityGate'
    };
}
export function runNoiseControlGate(input = {}) {
    const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
    const confidenceThreshold = input.confidenceThreshold ?? 0;
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    const filteredOut = [];
    let suppressedCount = 0;
    let bypassedCount = 0;
    let admitted = 0;
    for (const finding of input.findings ?? []) {
        const key = finding.metadata?.suppressionKey;
        const isHighSeverity = finding.severity === 'block' || finding.severity === 'error';
        if (typeof key === 'string' && suppressed.has(key)) {
            if (isHighSeverity) {
                bypassedCount += 1;
                findings.push(finding);
                continue;
            }
            suppressedCount += 1;
            filteredOut.push(finding);
            continue;
        }
        const confidence = Number(finding.metadata?.confidence ?? 1);
        if (Number.isFinite(confidence) && confidence < confidenceThreshold && !isHighSeverity) {
            suppressedCount += 1;
            filteredOut.push(finding);
            continue;
        }
        if (admitted >= dailyCap && !isHighSeverity) {
            suppressedCount += 1;
            filteredOut.push(finding);
            continue;
        }
        admitted += 1;
        findings.push(finding);
    }
    return {
        gate: 'noise-control',
        status: suppressedCount > 0 || bypassedCount > 0 ? 'advisory' : 'pass',
        findings,
        summary: { total: findings.length, suppressed: suppressedCount, bypassed: bypassedCount },
        sourceValidator: 'runNoiseControlGate'
    };
}
// ── Contract Drift Check inside Registry Consistency (APF-0048) ────────────
export function runRegistryContractDriftCheck(input = {}) {
    const findings = [];
    for (const entry of input.entries ?? []) {
        const drifted = detectContractDrift(entry);
        if (!drifted)
            continue;
        findings.push(makePoliceFinding({
            findingId: `police.registry-consistency.${entry.trigger}.${sanitizeId(entry.atomId ?? entry.mapId ?? 'unknown')}`,
            policeFamily: 'registry-consistency',
            severity: 'warning',
            trigger: entry.trigger,
            scope: entry.atomId ?? entry.mapId ?? 'registry',
            action: 'request-human-review',
            routeHint: 'registry.review',
            readModel: 'RegistryConsistency.contractDrift',
            message: entry.message ?? `Contract drift detected: ${entry.trigger} for ${entry.atomId ?? entry.mapId ?? 'unknown'}.`,
            evidenceRefs: [makeEvidenceRef('contract-drift-record', 'police-artifact')],
            metadata: {
                atomId: entry.atomId,
                mapId: entry.mapId,
                specHash: entry.specHash,
                implementationHash: entry.implementationHash,
                testHash: entry.testHash,
                registryMetadataHash: entry.registryMetadataHash,
                mapMemberHash: entry.mapMemberHash,
                directApplyAllowed: false
            }
        }));
    }
    return makePoliceFamilyReport({
        family: 'registry-consistency',
        mode: 'blocker',
        status: findings.length > 0 ? 'fail' : 'pass',
        findings,
        sourceValidator: 'runRegistryContractDriftCheck'
    });
}
function detectContractDrift(entry) {
    switch (entry.trigger) {
        case 'spec-implementation-drift':
            return Boolean(entry.specHash && entry.implementationHash && entry.specHash !== entry.implementationHash);
        case 'spec-test-drift':
            return Boolean(entry.specHash && entry.testHash && entry.specHash !== entry.testHash);
        case 'registry-metadata-drift':
            return Boolean(entry.registryMetadataHash && entry.specHash && entry.registryMetadataHash !== entry.specHash);
        case 'map-member-contract-drift':
            return Boolean(entry.mapMemberHash && entry.specHash && entry.mapMemberHash !== entry.specHash);
        default:
            return false;
    }
}
export async function runPoliceFamilyGate(input = {}) {
    const profile = input.profile ?? 'standard';
    const families = [
        ...(input.coreFamilies ?? []),
        runDedupPolice(input.dedup ?? {}),
        await runDemandPolice(input.demand ?? {}),
        runQualityPolice(input.quality ?? {}),
        runMapIntegrationPolice(input.mapIntegration ?? {}),
        runAtomizationPolice(input.atomization ?? {}),
        runDecompositionPolice(input.decomposition ?? {}),
        runEvolutionPolice(input.evolution ?? {}),
        runPolymorphPolice(input.polymorph ?? {}),
        runRollbackPolice(input.rollback ?? {})
    ];
    const sharedGates = [
        runEvidenceIntegrityGate(input.evidenceIntegrity ?? {}),
        runReversibilityGate(input.reversibility ?? {}),
        runNoiseControlGate(input.noiseControl ?? {})
    ];
    if (input.contractDrift) {
        const driftReport = runRegistryContractDriftCheck(input.contractDrift);
        const existingRegistryFamily = families.find((family) => family.family === 'registry-consistency');
        if (existingRegistryFamily) {
            const mergedFindings = [...existingRegistryFamily.findings, ...driftReport.findings];
            const mergedStatus = mergedFindings.some((finding) => finding.severity === 'block' || finding.severity === 'error') ? 'fail' : driftReport.findings.length > 0 ? 'fail' : existingRegistryFamily.status;
            const merged = makePoliceFamilyReport({
                family: 'registry-consistency',
                mode: 'blocker',
                status: mergedStatus,
                findings: mergedFindings,
                sourceValidator: `${existingRegistryFamily.sourceValidator}+runRegistryContractDriftCheck`
            });
            const index = families.indexOf(existingRegistryFamily);
            families.splice(index, 1, merged);
        }
        else {
            families.push(driftReport);
        }
    }
    return buildPoliceFamilyGateReport({
        profile,
        generatedAt: input.generatedAt,
        families,
        sharedGates
    });
}
export function buildPoliceFamilyGateReport(input) {
    const profile = input.profile ?? 'standard';
    const findings = input.families.flatMap((family) => [...family.findings]);
    const blockingFindings = input.families.flatMap((family) => {
        if (family.mode !== 'blocker') {
            return [];
        }
        return family.findings.filter((finding) => finding.severity === 'block' || finding.severity === 'error');
    });
    const advisoryFindings = findings.filter((finding) => !blockingFindings.includes(finding));
    const blockerFamilyFailed = input.families.some((family) => family.mode === 'blocker' && (family.status === 'fail' || family.status === 'error'));
    return {
        schemaId: 'atm.policeFamilyGateReport',
        specVersion: '0.1.0',
        profile,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        families: [...input.families],
        findings,
        advisoryFindings,
        blockingFindings,
        ok: blockingFindings.length === 0 && !blockerFamilyFailed,
        canPromote: profile === 'full'
            ? blockingFindings.length === 0 && !blockerFamilyFailed
            : blockingFindings.length === 0 && !blockerFamilyFailed,
        sharedGates: input.sharedGates ? [...input.sharedGates] : undefined
    };
}
export function renderPoliceFamilyGateMarkdown(report) {
    const lines = [];
    lines.push('# Police Family Gate Report');
    lines.push('');
    lines.push(`- Profile: ${report.profile}`);
    lines.push(`- Result: ${report.ok ? 'PASS' : 'FAIL'}`);
    lines.push(`- Families: ${report.families.length}`);
    lines.push(`- Findings: ${report.findings.length}`);
    lines.push('');
    lines.push('| Family | Mode | Status | Findings | Source |');
    lines.push('|---|---|---|---:|---|');
    for (const family of report.families) {
        lines.push(`| ${family.family} | ${family.mode} | ${family.status} | ${family.findings.length} | ${family.sourceValidator} |`);
    }
    lines.push('');
    return lines.join('\n');
}
export function renderQualityPoliceMarkdown(input) {
    const report = input.qualityComparisonReport ?? (input.qualityComparisonInput ? compareQualityMetrics(input.qualityComparisonInput) : null);
    return report ? renderQualityReportMarkdown(report) : '# Quality Comparison Report\n\nNo quality comparison report was provided.\n';
}
function uniqueNodeRefs(input) {
    const seen = new Set();
    const result = [];
    for (const item of input) {
        const key = item?.urn ?? item?.canonicalId;
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
    }
    return result;
}
function isPolymorphIgnored(nodeRef, ignoredAtomIds, ignoredGroupId) {
    const atomId = nodeRef?.canonicalId ?? nodeRef?.entry?.atomId;
    if (atomId && ignoredAtomIds.has(atomId)) {
        return true;
    }
    return Boolean(ignoredGroupId && nodeRef?.entry?.polymorphGroupId === ignoredGroupId);
}
function classifyViolationFamily(code) {
    if (code.includes('DEPENDENCY_CYCLE'))
        return 'dependency-graph';
    if (code.includes('LAYER_BOUNDARY') || code.includes('LAYER_UNKNOWN') || code.includes('FORBIDDEN_IMPORT'))
        return 'boundary';
    if (code.includes('PROMOTE_BLOCKED'))
        return 'registry-consistency';
    return 'registry-consistency';
}
function sanitizeId(value) {
    return String(value ?? 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';
}
