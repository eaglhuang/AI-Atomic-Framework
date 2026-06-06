import { createRegistryIndex } from '../registry/registry-index.ts';
import { type BuildLegacyRoutePlanInput, type LegacyRoutePlan } from '../guidance/legacy-route-plan.ts';
import { type AtomMapCuratorInput, type AtomMapCuratorReport } from '../upgrade/map-curator.ts';
import { type SourceInventoryEntry, type SourceInventoryReport } from '../source-inventory/source-inventory.ts';
export type PoliceFamilyName = 'schema' | 'boundary' | 'dependency-graph' | 'registry-consistency' | 'lifecycle' | 'dedup' | 'demand' | 'quality' | 'map-integration' | 'atomization' | 'decomposition' | 'evolution' | 'polymorph' | 'rollback' | 'rescue';
export type SharedGateName = 'evidence-integrity' | 'reversibility' | 'noise-control';
export type PoliceFindingSeverity = 'info' | 'advisory' | 'warning' | 'block' | 'error';
export type PoliceFindingAction = 'report-only' | 'monitor' | 'needs-review' | 'request-human-review' | 'follow-up-task' | 'proposal-draft' | 'quarantine' | 'hard-fail';
export type PoliceFindingMode = 'fast' | 'slow';
export type PoliceFamilyMode = 'blocker' | 'advisory';
export type PoliceFamilyStatus = 'pass' | 'fail' | 'error' | 'skipped';
export type PoliceFamilyProfile = 'standard' | 'full';
export interface EvidenceRef {
    readonly refId: string;
    readonly refKind: 'official-evidence' | 'police-artifact' | 'read-model' | 'fixture';
    readonly evidenceType?: 'usage-feedback' | 'quality-baseline' | 'quality-comparison' | 'rollback-proof' | 'human-review-decision';
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
export type EvolutionPoliceSignalKind = 'evidence-evolution-signal' | 'map-evolution-signal' | 'stale-evolution-draft';
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
export type PolymorphPoliceSignalKind = 'template-drift' | 'instance-propagation-missing' | 'variant-explosion' | 'polymorph-dimension-drift';
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
export declare const DEFAULT_POLYMORPH_VARIANT_THRESHOLD = 12;
export declare function buildPolymorphSuppressionKey(input: {
    readonly templateId: string;
    readonly signalKind: PolymorphPoliceSignalKind;
    readonly instanceId?: string;
    readonly templateVersion?: string;
}): string;
export type RollbackPoliceSignalKind = 'rollback-proof-missing' | 'rollback-scope-drift' | 'irreversible-proposal' | 'equivalence-proof-missing' | 'retirement-proof-missing';
export type RollbackProposalRiskClass = 'atom-evolve' | 'map-replacement' | 'legacy-retired' | 'atomize' | 'infect' | 'polymorph';
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
export declare function buildRollbackSuppressionKey(input: {
    readonly proposalId: string;
    readonly signalKind: RollbackPoliceSignalKind;
    readonly baseVersion?: string;
}): string;
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
    readonly proposalEvidenceRefs?: ReadonlyArray<{
        proposalId: string;
        refIds: readonly string[];
    }>;
}
export declare const DEFAULT_EVIDENCE_MAX_AGE_MS: number;
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
export type AdopterNeutralityTermClass = 'adopter-project-name' | 'adopter-engine-name' | 'adopter-private-path' | 'adopter-host-only-asset' | 'adopter-private-tooling';
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
export declare function runAdopterNeutralityCheck(input?: AdopterNeutralityCheckInput): PoliceFamilyReport;
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
export declare function verifyAdvisoryOnlyHardening(input?: AdvisoryOnlyHardeningInput): AdvisoryOnlyHardeningReport;
export interface ValidatorProfileNamingContract {
    readonly schemaId: 'atm.validatorProfileNamingContract';
    readonly specVersion: '0.1.0';
    readonly profiles: ReadonlyArray<{
        readonly profile: 'validate:police' | 'validate:police-family' | 'validate:standard' | 'validate:full';
        readonly role: string;
        readonly relatesTo: readonly string[];
    }>;
}
export declare const VALIDATOR_PROFILE_NAMING_CONTRACT: ValidatorProfileNamingContract;
export type ContractDriftTrigger = 'spec-implementation-drift' | 'spec-test-drift' | 'registry-metadata-drift' | 'map-member-contract-drift';
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
export declare const DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD = 2;
export declare const DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD = 0.6;
export declare const DEFAULT_POLICE_DAILY_CAP = 50;
export declare function buildEvolutionSuppressionKey(entry: EvolutionEvidencePatternEntry): string;
export declare function buildDecompositionSuppressionKey(entry: SourceInventoryEntry): string;
export declare function buildCorePoliceFamilies(input: {
    readonly policeReport?: any;
    readonly lifecycleReport?: any;
}): PoliceFamilyReport[];
export declare function makeEvidenceRef(refId: string, refKind: EvidenceRef['refKind'], evidenceType?: EvidenceRef['evidenceType']): EvidenceRef;
export declare function makePoliceFinding(input: Omit<PoliceFinding, 'mode'> & Partial<Pick<PoliceFinding, 'mode'>>): PoliceFinding;
export declare function makePoliceFamilyReport(input: CorePoliceFacadeInput): PoliceFamilyReport;
export declare function toReviewAdvisorySeverity(severity: PoliceFindingSeverity): 'high' | 'medium' | 'low' | 'info';
export declare function toReviewAdvisoryAction(severity: PoliceFindingSeverity): 'monitor' | 'needs-review' | 'request-human-review';
export declare function toReviewAdvisoryMachineFinding(finding: PoliceFinding): {
    id: string;
    severity: "low" | "medium" | "high" | "info";
    message: string;
    routeHint: string;
    evidenceRefs: string[] | undefined;
    metadata: {
        policeFinding: PoliceFinding;
    };
};
export declare function runDedupPolice(input?: DedupPoliceInput): PoliceFamilyReport;
export declare function runDemandPolice(input?: DemandPoliceInput): Promise<PoliceFamilyReport>;
export declare function runQualityPolice(input?: QualityPoliceInput): PoliceFamilyReport;
export declare function runMapIntegrationPolice(input?: MapIntegrationPoliceInput): PoliceFamilyReport;
export declare function runAtomizationPolice(input?: AtomizationPoliceInput): PoliceFamilyReport;
export declare function runDecompositionPolice(input?: DecompositionPoliceInput): PoliceFamilyReport;
export declare function buildDecompositionPlanHintDraft(finding: PoliceFinding): {
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
};
export declare function runEvolutionPolice(input?: EvolutionPoliceInput): PoliceFamilyReport;
export declare function runPolymorphPolice(input?: PolymorphPoliceInput): PoliceFamilyReport;
export declare function runRollbackPolice(input?: RollbackPoliceInput): PoliceFamilyReport;
export declare function runEvidenceIntegrityGate(input?: EvidenceIntegrityGateInput): SharedGateReport;
export declare function runReversibilityGate(input?: ReversibilityGateInput): SharedGateReport;
export declare function runNoiseControlGate(input?: NoiseControlGateInput): SharedGateReport;
export declare function runRegistryContractDriftCheck(input?: ContractDriftCheckInput): PoliceFamilyReport;
export declare function runPoliceFamilyGate(input?: PoliceFamilyGateInput): Promise<PoliceFamilyGateReport>;
export declare function buildPoliceFamilyGateReport(input: {
    readonly profile?: PoliceFamilyProfile;
    readonly generatedAt?: string;
    readonly families: readonly PoliceFamilyReport[];
    readonly sharedGates?: readonly SharedGateReport[];
}): PoliceFamilyGateReport;
export declare function renderPoliceFamilyGateMarkdown(report: PoliceFamilyGateReport): string;
export declare function renderQualityPoliceMarkdown(input: QualityPoliceInput): string;
