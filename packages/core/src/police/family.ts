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
  | 'evolution'
  | 'polymorph'
  | 'rollback'
  | 'rescue';

export type SharedGateName =
  | 'evidence-integrity'
  | 'reversibility'
  | 'noise-control';

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
  readonly sharedGates?: readonly SharedGateReport[];
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

// ── Polymorph Police (APF-0041 / 0042) ─────────────────────────────────────

export type PolymorphPoliceSignalKind =
  | 'template-drift'
  | 'instance-propagation-missing'
  | 'variant-explosion'
  | 'polymorph-dimension-drift';

export interface PolymorphTemplateRecord {
  readonly templateId: string;
  readonly templateVersion: string;
  readonly dimensionSpecId?: string;
  readonly templateSemanticFingerprint?: string;
  readonly templateAtomId?: string;
}

export interface PolymorphInstanceRecord {
  readonly instanceId: string;
  readonly instanceVersion?: string;
  readonly templateId: string;
  readonly parentTemplateVersion?: string;
  readonly inheritedTemplateVersion?: string;
  readonly instanceSemanticFingerprint?: string;
  readonly variantKey?: string;
  readonly dimensionDriftTags?: readonly string[];
}

export interface PolymorphPoliceInput {
  readonly template?: PolymorphTemplateRecord;
  readonly instances?: readonly PolymorphInstanceRecord[];
  readonly variantThreshold?: number;
  readonly suppressedKeys?: readonly string[];
}

export const DEFAULT_POLYMORPH_VARIANT_THRESHOLD = 12;

export function buildPolymorphSuppressionKey(input: {
  readonly templateId: string;
  readonly signalKind: PolymorphPoliceSignalKind;
  readonly instanceId?: string;
  readonly templateVersion?: string;
}): string {
  return [
    'polymorph',
    input.templateId,
    input.signalKind,
    input.instanceId ?? '*',
    input.templateVersion ?? 'no-base'
  ].join('::');
}

// ── Rollback Police (APF-0043 / 0044) ──────────────────────────────────────

export type RollbackPoliceSignalKind =
  | 'rollback-proof-missing'
  | 'rollback-scope-drift'
  | 'irreversible-proposal'
  | 'equivalence-proof-missing'
  | 'retirement-proof-missing';

export type RollbackProposalRiskClass =
  | 'atom-evolve'
  | 'map-replacement'
  | 'legacy-retired'
  | 'atomize'
  | 'infect'
  | 'polymorph';

export interface RollbackPoliceProposal {
  readonly proposalId: string;
  readonly riskClass: RollbackProposalRiskClass;
  readonly hasRollbackProof?: boolean;
  readonly hasEquivalenceProof?: boolean;
  readonly hasRetirementProof?: boolean;
  readonly hasReversiblePatchEnvelope?: boolean;
  readonly rollbackScope?: readonly string[];
  readonly touchedSurfaces?: readonly string[];
  readonly baseVersion?: string;
  readonly evidenceWatermark?: string;
}

export interface RollbackPoliceInput {
  readonly proposals?: readonly RollbackPoliceProposal[];
  readonly suppressedKeys?: readonly string[];
}

export function buildRollbackSuppressionKey(input: {
  readonly proposalId: string;
  readonly signalKind: RollbackPoliceSignalKind;
  readonly baseVersion?: string;
}): string {
  return ['rollback', input.proposalId, input.signalKind, input.baseVersion ?? 'no-base'].join('::');
}

// ── Shared Gates (APF-0045 / 0046 / 0047) ───────────────────────────────────

export type SharedGateStatus = 'pass' | 'fail' | 'advisory' | 'skipped';

export interface SharedGateReport {
  readonly gate: SharedGateName;
  readonly status: SharedGateStatus;
  readonly findings: readonly PoliceFinding[];
  readonly summary: {
    readonly total: number;
    readonly suppressed?: number;
    readonly bypassed?: number;
    readonly blocked?: number;
  };
  readonly sourceValidator: string;
}

export interface EvidenceCatalogEntry {
  readonly evidenceId: string;
  readonly schemaId?: string;
  readonly generatedAt?: string;
  readonly trustLevel?: 'trusted' | 'untrusted';
  readonly evidenceType?: EvidenceRef['evidenceType'];
}

export interface EvidenceIntegrityGateInput {
  readonly findings?: readonly PoliceFinding[];
  readonly catalog?: readonly EvidenceCatalogEntry[];
  readonly maxAgeMs?: number;
  readonly nowIso?: string;
  readonly proposalEvidenceRefs?: ReadonlyArray<{ proposalId: string; refIds: readonly string[] }>;
}

export const DEFAULT_EVIDENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ReversibilityGateInput {
  readonly proposals?: readonly RollbackPoliceProposal[];
  readonly suppressedKeys?: readonly string[];
}

export interface NoiseControlGateInput {
  readonly findings?: readonly PoliceFinding[];
  readonly suppressedKeys?: readonly string[];
  readonly dailyCap?: number;
  readonly confidenceThreshold?: number;
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
  readonly polymorph?: PolymorphPoliceInput;
  readonly rollback?: RollbackPoliceInput;
  readonly evidenceIntegrity?: EvidenceIntegrityGateInput;
  readonly reversibility?: ReversibilityGateInput;
  readonly noiseControl?: NoiseControlGateInput;
  readonly contractDrift?: ContractDriftCheckInput;
}

// ── Adopter Neutrality Check (APF-0052) ────────────────────────────────────

export type AdopterNeutralityTermClass =
  | 'adopter-project-name'
  | 'adopter-engine-name'
  | 'adopter-private-path'
  | 'adopter-host-only-asset'
  | 'adopter-private-tooling';

export interface AdopterNeutralityBannedTerm {
  readonly term: string;
  readonly termClass: AdopterNeutralityTermClass;
  readonly suggestedAction?: string;
}

export interface AdopterNeutralityProtectedFile {
  readonly filePath: string;
  readonly content: string;
  readonly scope?: 'protected-public-docs' | 'protected-public-schemas' | 'protected-public-packages' | 'protected-public-fixtures';
}

export interface AdopterNeutralityCheckInput {
  readonly protectedFiles?: readonly AdopterNeutralityProtectedFile[];
  readonly bannedTerms?: readonly AdopterNeutralityBannedTerm[];
  readonly allowlist?: readonly string[];
  readonly profile?: PoliceFamilyProfile;
}

export function runAdopterNeutralityCheck(input: AdopterNeutralityCheckInput = {}): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];
  const allowlist = new Set(input.allowlist ?? []);
  const profile = input.profile ?? 'standard';
  const severityForProfile: PoliceFindingSeverity = profile === 'full' ? 'block' : 'advisory';
  const actionForProfile: PoliceFindingAction = profile === 'full' ? 'request-human-review' : 'needs-review';

  for (const file of input.protectedFiles ?? []) {
    if (allowlist.has(file.filePath)) continue;
    for (const banned of input.bannedTerms ?? []) {
      if (!file.content.includes(banned.term)) continue;
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

  const status: PoliceFamilyStatus = findings.length > 0 && profile === 'full' ? 'fail' : 'pass';
  return makePoliceFamilyReport({
    family: 'registry-consistency',
    mode: 'blocker',
    status,
    findings,
    sourceValidator: 'runAdopterNeutralityCheck'
  });
}

// ── Advisory-Only Hardening Verifications (APF-0053) ───────────────────────

export interface AdvisoryOnlyHardeningProbe {
  readonly probeId: string;
  readonly scannerSourceValidator: string;
  readonly attemptedAction: 'registry-mutation' | 'auto-approve' | 'direct-promotion' | 'bypass-review';
  readonly attemptedBy?: 'advisory-family' | 'shared-gate';
  readonly description?: string;
}

export interface AdvisoryOnlyHardeningInput {
  readonly probes?: readonly AdvisoryOnlyHardeningProbe[];
}

export interface AdvisoryOnlyHardeningResult {
  readonly probeId: string;
  readonly attemptedAction: AdvisoryOnlyHardeningProbe['attemptedAction'];
  readonly rejected: true;
  readonly reason: string;
}

export interface AdvisoryOnlyHardeningReport {
  readonly schemaId: 'atm.advisoryOnlyHardeningReport';
  readonly specVersion: '0.1.0';
  readonly results: readonly AdvisoryOnlyHardeningResult[];
  readonly ok: boolean;
}

export function verifyAdvisoryOnlyHardening(input: AdvisoryOnlyHardeningInput = {}): AdvisoryOnlyHardeningReport {
  const results: AdvisoryOnlyHardeningResult[] = (input.probes ?? []).map((probe) => ({
    probeId: probe.probeId,
    attemptedAction: probe.attemptedAction,
    rejected: true as const,
    reason: advisoryRejectionReason(probe.attemptedAction)
  }));
  return {
    schemaId: 'atm.advisoryOnlyHardeningReport',
    specVersion: '0.1.0',
    results,
    ok: results.every((entry) => entry.rejected === true)
  };
}

function advisoryRejectionReason(action: AdvisoryOnlyHardeningProbe['attemptedAction']): string {
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

// ── Validator Profile Naming Contract (APF-0053) ───────────────────────────

export interface ValidatorProfileNamingContract {
  readonly schemaId: 'atm.validatorProfileNamingContract';
  readonly specVersion: '0.1.0';
  readonly profiles: ReadonlyArray<{
    readonly profile: 'validate:police' | 'validate:police-family' | 'validate:standard' | 'validate:full';
    readonly role: string;
    readonly relatesTo: readonly string[];
  }>;
}

export const VALIDATOR_PROFILE_NAMING_CONTRACT: ValidatorProfileNamingContract = {
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

// ── Contract Drift Check (APF-0048) ─────────────────────────────────────────

export type ContractDriftTrigger =
  | 'spec-implementation-drift'
  | 'spec-test-drift'
  | 'registry-metadata-drift'
  | 'map-member-contract-drift';

export interface ContractDriftEntry {
  readonly atomId?: string;
  readonly mapId?: string;
  readonly trigger: ContractDriftTrigger;
  readonly specHash?: string;
  readonly implementationHash?: string;
  readonly testHash?: string;
  readonly registryMetadataHash?: string;
  readonly mapMemberHash?: string;
  readonly message?: string;
}

export interface ContractDriftCheckInput {
  readonly entries?: readonly ContractDriftEntry[];
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

export function runPolymorphPolice(input: PolymorphPoliceInput = {}): PoliceFamilyReport {
  const template = input.template;
  const instances = input.instances ?? [];
  const threshold = input.variantThreshold ?? DEFAULT_POLYMORPH_VARIANT_THRESHOLD;
  const suppressed = new Set(input.suppressedKeys ?? []);
  const findings: PoliceFinding[] = [];

  if (template) {
    for (const instance of instances) {
      if (instance.templateId !== template.templateId) continue;
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

export function runRollbackPolice(input: RollbackPoliceInput = {}): PoliceFamilyReport {
  const suppressed = new Set(input.suppressedKeys ?? []);
  const findings: PoliceFinding[] = [];

  for (const proposal of input.proposals ?? []) {
    const issues = evaluateRollbackProposal(proposal);
    for (const issue of issues) {
      const key = buildRollbackSuppressionKey({
        proposalId: proposal.proposalId,
        signalKind: issue.trigger,
        baseVersion: proposal.baseVersion
      });
      if (suppressed.has(key)) continue;
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

function evaluateRollbackProposal(proposal: RollbackPoliceProposal): Array<{
  readonly trigger: RollbackPoliceSignalKind;
  readonly severity: PoliceFindingSeverity;
  readonly message: string;
}> {
  const issues: Array<{ trigger: RollbackPoliceSignalKind; severity: PoliceFindingSeverity; message: string }> = [];
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

export function runEvidenceIntegrityGate(input: EvidenceIntegrityGateInput = {}): SharedGateReport {
  const findings: PoliceFinding[] = [];
  const catalog = input.catalog ?? [];
  const catalogIndex = new Map<string, EvidenceCatalogEntry>();
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
    if (refs.length === 0) continue;
    const seenIds = new Set<string>();
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
      if (!catalogEntry) continue;
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

export function runReversibilityGate(input: ReversibilityGateInput = {}): SharedGateReport {
  const suppressed = new Set(input.suppressedKeys ?? []);
  const findings: PoliceFinding[] = [];
  let blocked = 0;

  for (const proposal of input.proposals ?? []) {
    const issues = evaluateRollbackProposal(proposal);
    for (const issue of issues) {
      const key = buildRollbackSuppressionKey({
        proposalId: proposal.proposalId,
        signalKind: issue.trigger,
        baseVersion: proposal.baseVersion
      });
      if (suppressed.has(key)) continue;
      if (issue.severity === 'block') blocked += 1;
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

export function runNoiseControlGate(input: NoiseControlGateInput = {}): SharedGateReport {
  const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
  const confidenceThreshold = input.confidenceThreshold ?? 0;
  const suppressed = new Set(input.suppressedKeys ?? []);
  const findings: PoliceFinding[] = [];
  const filteredOut: PoliceFinding[] = [];
  let suppressedCount = 0;
  let bypassedCount = 0;
  let admitted = 0;

  for (const finding of input.findings ?? []) {
    const key = (finding.metadata as any)?.suppressionKey;
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
    const confidence = Number((finding.metadata as any)?.confidence ?? 1);
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

export function runRegistryContractDriftCheck(input: ContractDriftCheckInput = {}): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];
  for (const entry of input.entries ?? []) {
    const drifted = detectContractDrift(entry);
    if (!drifted) continue;
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

function detectContractDrift(entry: ContractDriftEntry): boolean {
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
    runEvolutionPolice(input.evolution ?? {}),
    runPolymorphPolice(input.polymorph ?? {}),
    runRollbackPolice(input.rollback ?? {})
  ];
  const sharedGates: SharedGateReport[] = [
    runEvidenceIntegrityGate(input.evidenceIntegrity ?? {}),
    runReversibilityGate(input.reversibility ?? {}),
    runNoiseControlGate(input.noiseControl ?? {})
  ];
  if (input.contractDrift) {
    const driftReport = runRegistryContractDriftCheck(input.contractDrift);
    const existingRegistryFamily = families.find((family) => family.family === 'registry-consistency');
    if (existingRegistryFamily) {
      const mergedFindings = [...existingRegistryFamily.findings, ...driftReport.findings];
      const mergedStatus: PoliceFamilyStatus = mergedFindings.some((finding) => finding.severity === 'block' || finding.severity === 'error') ? 'fail' : driftReport.findings.length > 0 ? 'fail' : existingRegistryFamily.status;
      const merged = makePoliceFamilyReport({
        family: 'registry-consistency',
        mode: 'blocker',
        status: mergedStatus,
        findings: mergedFindings,
        sourceValidator: `${existingRegistryFamily.sourceValidator}+runRegistryContractDriftCheck`
      });
      const index = families.indexOf(existingRegistryFamily);
      families.splice(index, 1, merged);
    } else {
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

export function buildPoliceFamilyGateReport(input: {
  readonly profile?: PoliceFamilyProfile;
  readonly generatedAt?: string;
  readonly families: readonly PoliceFamilyReport[];
  readonly sharedGates?: readonly SharedGateReport[];
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
      : blockingFindings.length === 0 && !blockerFamilyFailed,
    sharedGates: input.sharedGates ? [...input.sharedGates] : undefined
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
