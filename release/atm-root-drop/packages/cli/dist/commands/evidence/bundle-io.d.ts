import { normalizeValidatorGateName, normalizeValidatorToken, canonicalizeValidatorIdentity, classifyValidatorTier, isClosureRequiredValidator, resolveValidatorExpectedCommand, detectAutoLinkedValidator, type ValidatorTier, type EvidenceFreshness, type ValidatorEvidenceState } from './validator-classification.ts';
import { collectRecordCommandRuns, readRecordValidationPasses, readRecordFreshness, hashString, readCommandRunsInputFile, normalizeEvidenceCommandRuns, readCurrentCommit, type CommandRunEvidenceInput } from './command-runs.ts';
import { classifyValidatorEvidenceState, buildMissingValidatorFinding, computeMissingValidatorReport, type MissingValidatorFinding, type ValidatorCatalogEntry, type MissingValidatorReport } from './missing-report.ts';
import { isRecord, isCommandRunProof, quoteForShell } from './shared-utils.ts';
export type EvidenceGate = 'close' | 'commit' | 'pr';
export type { EvidenceFreshness, ValidatorTier, ValidatorEvidenceState, CommandRunEvidenceInput };
export type { MissingValidatorFinding, ValidatorCatalogEntry, MissingValidatorReport };
export { computeMissingValidatorReport, classifyValidatorEvidenceState, buildMissingValidatorFinding, normalizeValidatorGateName, normalizeValidatorToken, canonicalizeValidatorIdentity, classifyValidatorTier, isClosureRequiredValidator, resolveValidatorExpectedCommand, detectAutoLinkedValidator, collectRecordCommandRuns, readRecordValidationPasses, readRecordFreshness, hashString, readCommandRunsInputFile, normalizeEvidenceCommandRuns, isRecord, isCommandRunProof, quoteForShell, readCurrentCommit };
type CanonicalEvidenceKind = 'test' | 'artifact' | 'attestation' | 'review' | 'commit' | 'waiver' | 'other';
export declare const EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID = "atm.evidenceBundleManifest.v1";
export declare const TEAM_ARTIFACT_HANDOFF_EVIDENCE_SCHEMA_ID = "atm.teamArtifactHandoffEvidence.v1";
export declare const TEAM_CLOSURE_ATTESTATION_SCHEMA_ID = "atm.teamClosureAttestation.v1";
export interface EvidenceBundleManifest {
    readonly schemaId: typeof EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID;
    readonly taskId: string;
    readonly updatedAt: string;
    readonly updatedBy: string;
    readonly freshValidationPasses: readonly string[];
    readonly staleValidationPasses: readonly string[];
    readonly commandRuns: readonly Record<string, unknown>[];
    readonly artifactPaths: readonly string[];
}
export interface TeamArtifactHandoffEvidence {
    readonly schemaId: typeof TEAM_ARTIFACT_HANDOFF_EVIDENCE_SCHEMA_ID;
    readonly producedArtifacts: readonly string[];
    readonly missingArtifacts: readonly string[];
    readonly retryBudgetStatus: string;
    readonly escalationTarget: string | null;
    readonly closeAllowed: boolean;
}
export interface TeamClosureReviewerIndependenceEvidence {
    readonly required: boolean;
    readonly satisfied: boolean;
    readonly policy: string;
    readonly reviewerProviderId: string | null;
    readonly reviewerModelId: string | null;
    readonly reviewerRuntimeAdapterId: string | null;
    readonly reason: string;
}
export interface TeamClosureBrokerSubagentEvidence {
    readonly schemaId: string | null;
    readonly enabled: boolean;
    readonly subagentId: string | null;
    readonly decisionSurface: string | null;
    readonly stewardId: string | null;
    readonly governs: readonly string[];
    readonly evidenceRequired: readonly string[];
    readonly authorityBoundary: {
        readonly fileWrite: boolean;
        readonly gitWrite: boolean;
        readonly taskLifecycle: boolean;
        readonly selfClose: boolean;
    };
}
export interface TeamClosureCommitLaneEvidence {
    readonly schemaId: string | null;
    readonly serializedBy: string | null;
    readonly ownerRole: string | null;
    readonly workerGitWrite: boolean;
}
export interface TeamClosureWorkerAuthorityBoundaryEvidence {
    readonly gitWrite: boolean;
    readonly taskLifecycle: boolean;
    readonly selfClose: boolean;
    readonly evidenceWriteOwner: string | null;
}
export interface TeamClosureAttestationEvidence {
    readonly schemaId: typeof TEAM_CLOSURE_ATTESTATION_SCHEMA_ID;
    readonly teamRunId: string;
    readonly runtimeMode: string;
    readonly runtimeLanguage: string;
    readonly runtimeAdapterId: string | null;
    readonly providerId: string | null;
    readonly sdkId: string | null;
    readonly modelId: string | null;
    readonly runnerKind: string;
    readonly runtimeVersion: string | null;
    readonly sandboxPolicyHash: string;
    readonly attestationSigner: string;
    readonly brokerSubagent: TeamClosureBrokerSubagentEvidence;
    readonly commitLane: TeamClosureCommitLaneEvidence;
    readonly workerAuthorityBoundary: TeamClosureWorkerAuthorityBoundaryEvidence;
    readonly reviewerIndependence: TeamClosureReviewerIndependenceEvidence;
    readonly attestedAt: string;
    readonly localRuntimeWrapperIsSecureSandboxProof: false;
    readonly commandBackedEvidenceRequired: true;
}
export declare function buildTeamArtifactHandoffEvidence(input: {
    producedArtifacts?: readonly string[];
    missingArtifacts?: readonly string[];
    retryBudgetStatus?: unknown;
    escalationTarget?: unknown;
    closeAllowed?: unknown;
}): TeamArtifactHandoffEvidence;
export declare function evidenceBundleManifestRelativePath(taskId: string): string;
export declare function evidenceBundleManifestPathForTask(cwd: string, taskId: string): string;
export declare function readEvidenceBundleManifest(cwd: string, taskId: string): EvidenceBundleManifest | null;
export interface EvidenceGateResult {
    readonly ok: boolean;
    readonly gate: EvidenceGate;
    readonly total: number;
    readonly counts: Readonly<Record<CanonicalEvidenceKind, number>>;
    readonly freshCount: number;
    readonly commandRunEvidenceCount: number;
    readonly reopenedRedteamTask: boolean;
    readonly codeOrFrameworkTask: boolean;
    readonly missing: readonly string[];
}
/** evidence validators --list --task <id> 的執行邏輯 */
export declare function runEvidenceValidators(argv: string[]): import("../shared.ts").CommandResult;
export type AutoEvidenceDisposition = 'to-run' | 'already-satisfied' | 'skipped-out-of-scope' | 'requires-approval';
export interface AutoEvidencePlanEntry {
    readonly validator: string;
    readonly capability: 'validator' | 'integration-test';
    readonly catalogKey: string | null;
    readonly disposition: AutoEvidenceDisposition;
    readonly command: string | null;
    readonly evidenceState: ValidatorEvidenceState;
    readonly reason: string;
    readonly requiredCommand: string | null;
    readonly linkedValidators: readonly string[];
}
export interface AutoEvidencePlan {
    readonly schemaId: 'atm.autoEvidencePlan.v1';
    readonly taskId: string;
    readonly mode: 'dry-run' | 'execute';
    readonly ok: boolean;
    readonly toRun: readonly AutoEvidencePlanEntry[];
    readonly alreadySatisfied: readonly AutoEvidencePlanEntry[];
    readonly skippedOutOfScope: readonly AutoEvidencePlanEntry[];
    readonly requiresApproval: readonly AutoEvidencePlanEntry[];
    readonly remediationCommand: string | null;
}
export interface AutoEvidenceExecutionResult {
    readonly schemaId: 'atm.autoEvidenceExecution.v1';
    readonly taskId: string;
    readonly ok: boolean;
    readonly plan: AutoEvidencePlan;
    readonly runs: ReadonlyArray<{
        readonly validator: string;
        readonly command: string;
        readonly ok: boolean;
        readonly errorCode?: string;
    }>;
    readonly failedValidator: string | null;
    readonly remediationCommand: string | null;
}
export declare function buildAutoEvidencePlan(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    mode?: 'dry-run' | 'execute';
}): AutoEvidencePlan;
export declare function executeAutoEvidencePlan(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    /**
     * TASK-RFT-0011: optional mapper that rewrites the command taskflow will
     * execute for a plan entry (e.g. switching a `node --strip-types scripts/foo.ts`
     * declaration to `npm run foo` when the two are equivalent). The mapper is
     * pure — evidence.ts does not know about npm-script equivalence rules on its
     * own; callers (taskflow.ts) inject one bound to the current package.json.
     */
    commandMapper?: (declaredCommand: string) => string;
}): AutoEvidenceExecutionResult;
/** evidence missing --task <id> --actor <actor> 的執行邏輯 */
export declare function runEvidenceMissing(argv: string[]): import("../shared.ts").CommandResult;
/** evidence run --task <id> --command "<cmd>" --recent-run 的執行邏輯 */
export declare function runEvidenceRun(argv: string[]): import("../shared.ts").CommandResult;
export declare function runEvidenceDiff(argv: string[]): import("../shared.ts").CommandResult;
export declare function verifyTaskEvidence(input: {
    cwd: string;
    taskId: string;
    gate: EvidenceGate;
    taskDocument?: Record<string, unknown> | null;
    taskDeclaredFiles?: readonly string[];
    frameworkTask?: boolean;
}): EvidenceGateResult;
export declare function runEvidenceAdd(argv: string[]): import("../shared.ts").CommandResult;
export declare function runEvidenceHistoricalBatch(argv: string[]): import("../shared.ts").CommandResult;
export declare function runEvidenceHistoricalBatchFinalize(argv: string[]): import("../shared.ts").CommandResult;
export declare function runEvidenceVerify(argv: string[]): import("../shared.ts").CommandResult;
export declare function runGitHeadEvidenceBackfill(argv: string[]): import("../shared.ts").CommandResult;
