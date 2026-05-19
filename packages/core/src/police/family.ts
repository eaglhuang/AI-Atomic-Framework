import {
  createRegistryIndex,
  normalizeSemanticFingerprint,
  semanticFingerprintPrefix
} from '../registry/registry-index.ts';
import {
  buildLegacyRoutePlan,
  type BuildLegacyRoutePlanInput,
  type LegacyRoutePlan
} from '../guidance/legacy-route-plan.ts';
import {
  compareQualityMetrics,
  renderQualityReportMarkdown
} from './regression-compare.ts';
import {
  curateAtomMapEvolution,
  type AtomMapCuratorInput,
  type AtomMapCuratorReport
} from '../upgrade/map-curator.ts';
import {
  filterEligibleForDecomposition,
  type SourceInventoryEntry,
  type SourceInventoryReport
} from '../source-inventory/source-inventory.ts';

export type PoliceFamilyName =
  | 'schema'
  | 'boundary'
  | 'dependency-graph'
  | 'registry-consistency'
  | 'lifecycle'
  | 'dedup'
  | 'demand'
  | 'quality'
  | 'map-integration'
  | 'atomization'
  | 'decomposition'
  | 'evolution';

export type PoliceFindingSeverity = 'info' | 'advisory' | 'warning' | 'block' | 'error';

export type PoliceFindingAction =
  | 'report-only'
  | 'monitor'
  | 'needs-review'
  | 'request-human-review'
  | 'follow-up-task'
  | 'proposal-draft'
  | 'quarantine'
  | 'hard-fail';

export type PoliceFindingMode = 'fast' | 'slow';

export type PoliceFamilyMode = 'blocker' | 'advisory';

export type PoliceFamilyStatus = 'pass' | 'fail' | 'error' | 'skipped';

export type PoliceFamilyProfile = 'standard' | 'full';

export interface EvidenceRef {
  readonly refId: string;
  readonly refKind: 'official-evidence' | 'police-artifact' | 'read-model' | 'fixture';
  readonly evidenceType?:
    | 'usage-feedback'
    | 'quality-baseline'
    | 'quality-comparison'
    | 'rollback-proof'
    | 'human-review-decision';
}

export interface PoliceFinding {
  readonly findingId: string;
  readonly policeFamily: PoliceFamilyName;
  readonly severity: PoliceFindingSeverity;
  readonly message: string;
  readonly trigger: string;
  readonly scope?: string;
  readonly action: PoliceFindingAction;
  readonly routeHint?: string;
  readonly readModel?: string;
  readonly mode: PoliceFindingMode;
  readonly evidenceRefs?: readonly EvidenceRef[];
  readonly metadata?: Record<string, unknown>;
}

export interface PoliceFamilyReport {
  readonly family: PoliceFamilyName;
  readonly mode: PoliceFamilyMode;
  readonly status: PoliceFamilyStatus;
  readonly findings: readonly PoliceFinding[];
  readonly advisoryOnly: boolean;
  readonly sourceValidator: string;
}

export interface PoliceFamilyGateReport {
  readonly schemaId: 'atm.policeFamilyGateReport';
  readonly specVersion: '0.1.0';
  readonly profile: PoliceFamilyProfile;
  readonly generatedAt: string;
  readonly families: readonly PoliceFamilyReport[];
  readonly findings: readonly PoliceFinding[];
  readonly advisoryFindings: readonly PoliceFinding[];
  readonly blockingFindings: readonly PoliceFinding[];
  readonly ok: boolean;
  readonly canPromote: boolean;
}

export interface CorePoliceFacadeInput {
  readonly sourceValidator: string;
  readonly family: PoliceFamilyName;
  readonly mode: PoliceFamilyMode;
  readonly findings?: readonly PoliceFinding[];
  readonly status?: PoliceFamilyStatus;
}

export interface DedupPoliceInput {
  readonly registryDocument?: unknown;
  readonly registryIndex?: ReturnType<typeof createRegistryIndex>;
  readonly qualityComparisonReport?: any;
  readonly polymorphContext?: {
    readonly groupId?: string;
    readonly instanceAtomIds?: readonly string[];
  } | null;
}

export interface DemandPoliceInput {
  readonly legacyRoutePlan?: LegacyRoutePlan;
  readonly buildLegacyRoutePlanInput?: BuildLegacyRoutePlanInput;
  readonly demandThreshold?: number;
}

export interface QualityPoliceInput {
  readonly qualityComparisonReport?: any;
  readonly qualityComparisonInput?: any;
}

export interface MapIntegrationPoliceInput {
  readonly curatorReport?: AtomMapCuratorReport;
  readonly curatorInput?: AtomMapCuratorInput;
  readonly qualityComparisonReport?: any;
}

export interface AtomizationPoliceInput {
  readonly legacyRoutePlan?: LegacyRoutePlan;
  readonly dryRunResult?: any;
}

export interface DecompositionPoliceInput {
  readonly inventory?: SourceInventoryReport;
  readonly maxFileLines?: number;
  readonly suppressedFilePaths?: readonly string[];
  readonly dailyCap?: number;
}

export type EvolutionPoliceSignalKind =
  | 'evidence-evolution-signal'
  | 'map-evolution-signal'
  | 'stale-evolution-draft';

export interface EvolutionEvidencePatternEntry {
  readonly targetSurface: string;
  readonly signalKind: EvolutionPoliceSignalKind;
  readonly atomId?: string;
  readonly atomMapId?: string;
  readonly patternTags: readonly string[];
  readonly recurrence: number;
  readonly confidence: number;
  readonly hasFrictionEvidence?: boolean;
  readonly hasRegressionEvidence?: boolean;
  readonly hasReviewEvidence?: boolean;
  readonly hasUsageOnlyEvidence?: boolean;
  readonly hostLocal?: boolean;
  readonly baseAtomVersion?: string;
  readonly currentAtomVersion?: string;
  readonly baseMapVersion?: string;
  readonly currentMapVersion?: string;
  readonly suggestedBehavior?: 'evolve' | 'compose' | 'merge' | 'dedup-merge' | 'sweep';
  readonly matchedEvidenceIds?: readonly string[];
}

export interface EvolutionPoliceInput {
  readonly evidencePatterns?: readonly EvolutionEvidencePatternEntry[];
  readonly suppressedKeys?: readonly string[];
  readonly recurrenceThreshold?: number;
  readonly confidenceThreshold?: number;
  readonly dailyCap?: number;
}

export interface PoliceFamilyGateInput {
  readonly profile?: PoliceFamilyProfile;
  readonly generatedAt?: string;
  readonly coreFamilies?: readonly PoliceFamilyReport[];
  readonly dedup?: DedupPoliceInput;
  readonly demand?: DemandPoliceInput;
  readonly quality?: QualityPoliceInput;
  readonly mapIntegration?: MapIntegrationPoliceInput;
  readonly atomization?: AtomizationPoliceInput;
  readonly decomposition?: DecompositionPoliceInput;
  readonly evolution?: EvolutionPoliceInput;
}

export const DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD = 2;
export const DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD = 0.6;
export const DEFAULT_POLICE_DAILY_CAP = 50;

export function buildEvolutionSuppressionKey(entry: EvolutionEvidencePatternEntry): string {
  const tags = (entry.patternTags ?? []).slice().sort().join('|');
  const targetId = entry.atomId ?? entry.atomMapId ?? 'unknown';
  const baseVersion = entry.baseAtomVersion ?? entry.baseMapVersion ?? 'no-base';
  return [entry.targetSurface, targetId, entry.signalKind, tags, baseVersion, 'evolution'].join('::');
}

export function buildDecompositionSuppressionKey(entry: SourceInventoryEntry): string {
  return ['source-surface', entry.legacyUri ?? entry.filePath, 'oversized-source-surface', 'decomposition'].join('::');
}

export function buildCorePoliceFamilies(input: {
  readonly policeReport?: any;
  readonly lifecycleReport?: any;
}): PoliceFamilyReport[] {
  const families: PoliceFamilyReport[] = [
    makePoliceFamilyReport({
      family: 'schema',
      mode: 'blocker',
      status: 'pass',
      findings: [],
      sourceValidator: 'schema-validator'
    })
  ];
  const coreFindings = (input.policeReport?.violations ?? []).map((violation: any, index: number) => {
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

  for (const familyName of ['dependency-graph', 'boundary', 'registry-consistency'] as const) {
    const findings = coreFindings.filter((finding: PoliceFinding) => finding.policeFamily === familyName);
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
      .filter((finding: any) => finding.action === 'hard-fail' || finding.action === 'quarantine')
      .map((finding: any, index: number) => makePoliceFinding({
        findingId: `police.lifecycle.${sanitizeId(finding.trigger)}.${index}`,
        policeFamily: 'lifecycle',
        severity: finding.severity === 'error' ? 'error' : 'warning',
        trigger: finding.trigger,
        scope: finding.scope,
        action: finding.action === 'quarantine' ? 'quarantine' : 'hard-fail',
        routeHint: 'lifecycle-police',
        readModel: 'LifecyclePoliceFinding',
        message: finding.message,
        evidenceRefs: (finding.callerIds ?? []).map((callerId: string) => makeEvidenceRef(callerId, 'read-model')),
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

export function makeEvidenceRef(
  refId: string,
  refKind: EvidenceRef['refKind'],
  evidenceType?: EvidenceRef['evidenceType']
): EvidenceRef {
  return {
    refId,
    refKind,
    evidenceType
  };
}

export function makePoliceFinding(input: Omit<PoliceFinding, 'mode'> & Partial<Pick<PoliceFinding, 'mode'>>): PoliceFinding {
  return {
    ...input,
    mode: input.mode ?? 'fast'
  };
}

export function makePoliceFamilyReport(input: CorePoliceFacadeInput): PoliceFamilyReport {
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

export function toReviewAdvisorySeverity(severity: PoliceFindingSeverity): 'high' | 'medium' | 'low' | 'info' {
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

export function toReviewAdvisoryAction(severity: PoliceFindingSeverity): 'monitor' | 'needs-review' | 'request-human-review' {
  if (severity === 'error' || severity === 'block') {
    return 'request-human-review';
  }
  if (severity === 'warning' || severity === 'advisory') {
    return 'needs-review';
  }
  return 'monitor';
}

export function toReviewAdvisoryMachineFinding(finding: PoliceFinding) {
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

export function runDedupPolice(input: DedupPoliceInput = {}): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];
  const index = input.registryIndex ?? (
    input.registryDocument ? createRegistryIndex(input.registryDocument, { allowDuplicates: true }) : null
  );
  const ignoredAtomIds = new Set(input.polymorphContext?.instanceAtomIds ?? []);
  const ignoredGroupId = input.polymorphContext?.groupId ?? null;
  const seenGroups = new Set<string>();

  if (index) {
    for (const nodeRef of index.nodeRefs) {
      const fingerprint = normalizeSemanticFingerprint(
        nodeRef.entry?.semanticFingerprint ?? nodeRef.entry?.mapSemanticFingerprint ?? null
      );
      if (!fingerprint) {
        continue;
      }
      if (seenGroups.has(fingerprint)) {
        continue;
      }
      seenGroups.add(fingerprint);
      const exactHits = index.findBySemanticFingerprint(fingerprint).filter((candidate: any) => !isPolymorphIgnored(candidate, ignoredAtomIds, ignoredGroupId));
      const prefixHits = index.findByFingerprintPrefix(semanticFingerprintPrefix(fingerprint)).filter((candidate: any) => !isPolymorphIgnored(candidate, ignoredAtomIds, ignoredGroupId));
      const uniqueHits = uniqueNodeRefs([...exactHits, ...prefixHits]);
      if (uniqueHits.length < 2) {
        continue;
      }
      findings.push(makePoliceFinding({
        findingId: `police.dedup.semantic-fingerprint-overlap.${sanitizeId(semanticFingerprintPrefix(fingerprint))}`,
        policeFamily: 'dedup',
        severity: 'advisory',
        trigger: 'semantic-fingerprint-overlap',
        scope: uniqueHits.map((hit: any) => hit.canonicalId).join(','),
        action: 'needs-review',
        routeHint: 'behavior.dedup-merge',
        readModel: 'RegistryIndex.semanticFingerprintPrefix',
        message: `Semantic fingerprint overlap detected for ${uniqueHits.map((hit: any) => hit.canonicalId).join(', ')}.`,
        evidenceRefs: [makeEvidenceRef('fingerprint-snapshot', 'police-artifact')],
        metadata: {
          matchMode: exactHits.length > 1 ? 'exact' : 'prefix',
          candidates: uniqueHits.map((hit: any) => ({
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

export async function runDemandPolice(input: DemandPoliceInput = {}): Promise<PoliceFamilyReport> {
  const plan = input.legacyRoutePlan ?? (
    input.buildLegacyRoutePlanInput ? await buildLegacyRoutePlan(input.buildLegacyRoutePlanInput) : null
  );
  const demandThreshold = input.demandThreshold ?? input.buildLegacyRoutePlanInput?.demandThreshold ?? 6;
  const findings: PoliceFinding[] = [];

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

export function runQualityPolice(input: QualityPoliceInput = {}): PoliceFamilyReport {
  const report = input.qualityComparisonReport ?? (
    input.qualityComparisonInput ? compareQualityMetrics(input.qualityComparisonInput) : null
  );
  const findings: PoliceFinding[] = [];

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

export function runMapIntegrationPolice(input: MapIntegrationPoliceInput = {}): PoliceFamilyReport {
  const report = input.curatorReport ?? (
    input.curatorInput ? curateAtomMapEvolution(input.curatorInput) : null
  );
  const findings: PoliceFinding[] = [];

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
        ...draft.sourceEvidenceIds.map((refId) => makeEvidenceRef(refId, 'official-evidence' as const, 'usage-feedback' as const))
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

export function runAtomizationPolice(input: AtomizationPoliceInput = {}): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];

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
    const contractFailures: string[] = [];
    if (!dryRunPatch) {
      contractFailures.push('missing-dry-run-patch');
    } else {
      if (dryRunPatch.dryRun !== true) contractFailures.push('dryRun-must-be-true');
      if (dryRunPatch.applyToHostProject === true) contractFailures.push('applyToHostProject-must-not-be-true');
      if (dryRunPatch.hostMutationAllowed === true) contractFailures.push('hostMutationAllowed-must-not-be-true');
      if (dryRunPatch.patchMode !== 'dry-run') contractFailures.push('patchMode-must-be-dry-run');
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

export function runDecompositionPolice(input: DecompositionPoliceInput = {}): PoliceFamilyReport {
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
  const findings: PoliceFinding[] = [];

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

export function buildDecompositionPlanHintDraft(finding: PoliceFinding): {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly draft?: {
    readonly schemaId: 'atm.decompositionPlanDraft';
    readonly specVersion: '0.1.0';
    readonly mode: 'draft';
    readonly legacyUris: readonly string[];
    readonly proposedMembers: readonly string[];
    readonly entrypoints: readonly string[];
  };
} {
  if (finding.policeFamily !== 'decomposition' || finding.trigger !== 'oversized-source-surface') {
    return { ok: false, errors: ['finding-not-decomposition-oversized-source-surface'] };
  }
  const hint = (finding.metadata as any)?.decompositionPlanHint;
  const errors: string[] = [];
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

export function runEvolutionPolice(input: EvolutionPoliceInput = {}): PoliceFamilyReport {
  const recurrenceThreshold = input.recurrenceThreshold ?? DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD;
  const confidenceThreshold = input.confidenceThreshold ?? DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD;
  const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
  const suppressed = new Set(input.suppressedKeys ?? []);
  const findings: PoliceFinding[] = [];
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

    if (suppressed.has(key)) continue;

    const hasNonUsageEvidence = Boolean(entry.hasFrictionEvidence || entry.hasRegressionEvidence || entry.hasReviewEvidence);
    if (entry.hasUsageOnlyEvidence && !hasNonUsageEvidence) continue;
    if (entry.hostLocal) continue;
    if (entry.recurrence < recurrenceThreshold) continue;
    if (entry.confidence < confidenceThreshold) continue;

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
    const evidenceRefs: EvidenceRef[] = [];
    if (entry.hasFrictionEvidence) evidenceRefs.push(makeEvidenceRef('friction-evidence', 'police-artifact'));
    if (entry.hasRegressionEvidence) evidenceRefs.push(makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison'));
    if (entry.hasReviewEvidence) evidenceRefs.push(makeEvidenceRef('human-review-decision', 'official-evidence', 'human-review-decision'));
    if (entry.hasUsageOnlyEvidence) evidenceRefs.push(makeEvidenceRef('usage-feedback', 'official-evidence', 'usage-feedback'));

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

export async function runPoliceFamilyGate(input: PoliceFamilyGateInput = {}): Promise<PoliceFamilyGateReport> {
  const profile = input.profile ?? 'standard';
  const families = [
    ...(input.coreFamilies ?? []),
    runDedupPolice(input.dedup ?? {}),
    await runDemandPolice(input.demand ?? {}),
    runQualityPolice(input.quality ?? {}),
    runMapIntegrationPolice(input.mapIntegration ?? {}),
    runAtomizationPolice(input.atomization ?? {}),
    runDecompositionPolice(input.decomposition ?? {}),
    runEvolutionPolice(input.evolution ?? {})
  ];
  return buildPoliceFamilyGateReport({
    profile,
    generatedAt: input.generatedAt,
    families
  });
}

export function buildPoliceFamilyGateReport(input: {
  readonly profile?: PoliceFamilyProfile;
  readonly generatedAt?: string;
  readonly families: readonly PoliceFamilyReport[];
}): PoliceFamilyGateReport {
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
      : blockingFindings.length === 0 && !blockerFamilyFailed
  };
}

export function renderPoliceFamilyGateMarkdown(report: PoliceFamilyGateReport): string {
  const lines: string[] = [];
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

export function renderQualityPoliceMarkdown(input: QualityPoliceInput): string {
  const report = input.qualityComparisonReport ?? (
    input.qualityComparisonInput ? compareQualityMetrics(input.qualityComparisonInput) : null
  );
  return report ? renderQualityReportMarkdown(report) : '# Quality Comparison Report\n\nNo quality comparison report was provided.\n';
}

function uniqueNodeRefs(input: readonly any[]): any[] {
  const seen = new Set<string>();
  const result: any[] = [];
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

function isPolymorphIgnored(nodeRef: any, ignoredAtomIds: ReadonlySet<string>, ignoredGroupId: string | null): boolean {
  const atomId = nodeRef?.canonicalId ?? nodeRef?.entry?.atomId;
  if (atomId && ignoredAtomIds.has(atomId)) {
    return true;
  }
  return Boolean(ignoredGroupId && nodeRef?.entry?.polymorphGroupId === ignoredGroupId);
}

function classifyViolationFamily(code: string): PoliceFamilyName {
  if (code.includes('DEPENDENCY_CYCLE')) return 'dependency-graph';
  if (code.includes('LAYER_BOUNDARY') || code.includes('LAYER_UNKNOWN') || code.includes('FORBIDDEN_IMPORT')) return 'boundary';
  if (code.includes('PROMOTE_BLOCKED')) return 'registry-consistency';
  return 'registry-consistency';
}

function sanitizeId(value: unknown): string {
  return String(value ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}
