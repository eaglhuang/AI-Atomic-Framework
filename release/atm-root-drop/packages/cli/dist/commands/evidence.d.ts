export type EvidenceGate = 'close' | 'commit' | 'pr';
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
export declare function runEvidence(argv: string[]): Promise<import("./shared.ts").CommandResult>;
/** validator tier 說明
 * - focused: 必須每次 task 重跑，例如 typecheck、validate:cli、validate:git-head-evidence
 * - batch: cache key 未變時可跨 task 重用，例如 framework-development、tasks-audit、doctor
 * - release: 只在 release task 需要，例如 validate:root-drop-release
 */
type ValidatorTier = 'focused' | 'batch' | 'milestone' | 'release';
export type ValidatorEvidenceState = 'pass' | 'absent' | 'failed-run' | 'stale' | 'diagnostic-only';
export interface MissingValidatorFinding {
    readonly code: string;
    readonly validator: string;
    readonly category: 'absent' | 'failed-run' | 'stale' | 'diagnostic-only';
    readonly summary: string;
    readonly requiredCommand: string;
}
export interface ValidatorCatalogEntry {
    readonly name: string;
    readonly tier: ValidatorTier;
    /** TASK-AAO-0017 follow-up：標記此 validator 是否為 closure gate 必要條件 */
    readonly closureRequired: boolean;
    readonly expectedCommand: string;
    readonly evidenceState: ValidatorEvidenceState;
}
export interface MissingValidatorReport {
    readonly schemaId: 'atm.missingValidatorReport.v1';
    readonly taskId: string;
    readonly ok: boolean;
    readonly tldr: string;
    readonly totalRequired: number;
    readonly passedCount: number;
    readonly missingCount: number;
    readonly categories: {
        readonly absent: readonly string[];
        readonly failedRun: readonly string[];
        readonly stale: readonly string[];
        readonly diagnosticOnly: readonly string[];
    };
    /** Closure-required 缺失（advisory gates 不會進入此清單） */
    readonly missingValidationPasses: readonly MissingValidatorFinding[];
    /** Closure-required 中 absent + failed-run 的 hard blocker 子集 */
    readonly blockingFindings: readonly MissingValidatorFinding[];
    /** TASK-AAO-0017 follow-up：batch-tier advisory gate 缺失，不阻擋 close */
    readonly advisoryFindings: readonly MissingValidatorFinding[];
    readonly validators: readonly ValidatorCatalogEntry[];
}
/**
 * TASK-AAO-0017: 計算缺失 validator 報告，可被 tasks close / batch checkpoint 的錯誤訊息引用，
 * 也可獨立供 `evidence missing` 子命令呼叫。
 */
export declare function computeMissingValidatorReport(cwd: string, taskId: string, actorId: string): MissingValidatorReport;
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
}): AutoEvidenceExecutionResult;
export declare function verifyTaskEvidence(input: {
    cwd: string;
    taskId: string;
    gate: EvidenceGate;
    taskDocument?: Record<string, unknown> | null;
    taskDeclaredFiles?: readonly string[];
    frameworkTask?: boolean;
}): EvidenceGateResult;
export declare function quoteForShell(arg: string): string;
export declare function detectAutoLinkedValidator(command: string): string | null;
export {};
