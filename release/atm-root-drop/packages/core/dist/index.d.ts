/**
 * Artifact version kind 判別器 — Slice 2 (TASK-AAO-0072)。
 *
 * - `semver`  : 語意版本，例如 "1.2.3"，可依 semver 規則排序。
 * - `git-sha` : 完整或縮短的 Git commit SHA，只能做 identity 比對，不排序。
 * - `sha256`  : SHA-256 內容摘要，只能做 identity 比對，不排序。
 * - `opaque`  : 其他沒有排序語意的版本字串。
 *
 * `dataVersion` 固定維持 semver；這個型別只套用於 `artifactVersion`。
 */
export type ArtifactVersionKind = 'semver' | 'git-sha' | 'sha256' | 'opaque';
export type AtomLifecycleStatus = 'planned' | 'reserved' | 'ready' | 'locked' | 'running' | 'review' | 'verified' | 'done' | 'blocked' | 'abandoned';
export interface AtomicPackageDescriptor {
    readonly packageName: string;
    readonly packageRole: string;
    readonly packageVersion: string;
}
export interface WorkItemRef {
    readonly workItemId: string;
    readonly title: string;
    readonly status: AtomLifecycleStatus;
    readonly owner?: string;
    readonly startedAt?: string;
    readonly startedByActor?: string;
}
export type ActorKind = 'human' | 'ai-agent' | 'automation';
export interface ActorRecord {
    readonly actorId: string;
    readonly actorKind: ActorKind;
    readonly displayName: string;
    readonly provider?: string;
    readonly editor?: string;
    readonly gitName?: string;
    readonly gitEmail?: string;
    readonly contact?: string;
    readonly capabilities?: readonly string[];
    readonly createdAt?: string;
    readonly updatedAt?: string;
}
export interface ActorRegistryDocument {
    readonly schemaId: 'atm.actorRegistry';
    readonly specVersion: '0.1.0';
    readonly dataVersion?: string;
    readonly artifactVersion?: string;
    readonly generatedAt: string;
    readonly actors: readonly ActorRecord[];
}
export interface ScopeLockMapEdgeSelectorRecord {
    readonly from: string;
    readonly to: string;
    readonly edgeKind?: 'data-flow' | 'control-flow' | 'event-flow' | 'validation' | 'fallback' | 'side-effect' | 'rollback';
}
export interface ScopeLockSelectorsRecord {
    readonly mapId?: string;
    readonly mapMembers?: readonly string[];
    readonly mapEdges?: readonly ScopeLockMapEdgeSelectorRecord[];
    readonly mapEntrypoints?: readonly string[];
    readonly legacyUris?: readonly string[];
}
export interface ScopeLockRecord {
    readonly schemaId?: 'atm.governanceScopeLock';
    readonly specVersion?: '0.1.0' | '0.2.0';
    readonly dataVersion?: string;
    readonly artifactVersion?: string;
    readonly migration?: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly workItemId: string;
    readonly lockedBy: string;
    readonly lockedAt: string;
    readonly actorId?: string;
    readonly leaseId?: string;
    readonly heartbeatAt?: string;
    readonly ttlSeconds?: number;
    readonly files: readonly string[];
    readonly reason?: string;
    readonly selectors?: ScopeLockSelectorsRecord;
}
export interface TaskClaimRecord {
    readonly actorId: string;
    readonly leaseId: string;
    readonly claimedAt: string;
    readonly heartbeatAt: string;
    readonly ttlSeconds: number;
    readonly files: readonly string[];
    readonly state: 'active' | 'released' | 'handoff' | 'taken_over';
    readonly handoffTo?: string;
    readonly reason?: string;
}
export interface ArtifactRecord {
    readonly artifactId?: string;
    readonly workItemId?: string;
    readonly artifactPath: string;
    readonly artifactKind: 'file' | 'log' | 'report' | 'snapshot';
    readonly producedBy: string;
    readonly createdAt?: string;
    readonly contentType?: string;
    readonly digest?: string;
    readonly tags?: readonly string[];
}
export type EvidenceSignalKind = 'user-correction' | 'recurring-failure' | 'loaded-but-wrong' | 'novel-technique' | 'workflow-success' | 'metric-regression' | 'rollback-success';
export type EvidenceSignalScope = 'host-local' | 'repo' | 'atom' | 'atom-map' | 'global';
export interface EvidenceRecurrence {
    readonly window: string;
    readonly count: number;
    readonly firstSeenAt?: string;
    readonly lastSeenAt?: string;
}
export interface EvidenceRecord {
    readonly evidenceId?: string;
    readonly workItemId?: string;
    readonly evidenceKind: 'validation' | 'review' | 'metric' | 'handoff';
    readonly dataVersion?: string;
    readonly artifactVersion?: string;
    readonly artifactVersionKind?: ArtifactVersionKind;
    readonly evidenceType?: 'usage-feedback' | 'quality-baseline' | 'quality-comparison' | 'rollback-proof' | 'human-review-decision';
    readonly signalKind?: EvidenceSignalKind;
    readonly signalScope?: EvidenceSignalScope;
    readonly atomId?: string;
    readonly atomMapId?: string;
    readonly patternTags?: readonly string[];
    readonly recurringSignal?: boolean;
    readonly confidence?: number;
    readonly recurrence?: EvidenceRecurrence;
    readonly summary: string;
    readonly artifactPaths: readonly string[];
    readonly createdAt?: string;
    readonly producedBy?: string;
    readonly reproducibility?: {
        readonly replayable: boolean;
        readonly replayCommand: readonly string[];
        readonly inputs?: readonly string[];
        readonly expectedArtifacts?: readonly string[];
        readonly notes: string;
    };
    readonly details?: Readonly<Record<string, unknown>>;
}
export interface ContextSummaryRecord {
    readonly summaryId?: string;
    readonly workItemId: string;
    readonly summary: string;
    readonly nextActions: readonly string[];
    readonly generatedAt?: string;
    readonly artifactPaths?: readonly string[];
    readonly evidencePaths?: readonly string[];
    readonly reportPaths?: readonly string[];
    readonly authoredBy?: string;
    readonly handoffKind?: 'bootstrap' | 'self-host-alpha' | 'continuation' | 'budget-hard-stop';
    readonly continuationGoal?: string;
    readonly resumePrompt?: string;
    readonly resumeCommand?: readonly string[];
    readonly budgetDecision?: 'pass' | 'summarize-before-continue' | 'hard-stop';
    readonly hardStop?: boolean;
    readonly summaryMarkdownPath?: string;
}
export type ValidationCommandKind = 'test' | 'typecheck' | 'lint' | 'custom';
export interface TestCommandContract {
    readonly commandId: string;
    readonly commandKind: ValidationCommandKind;
    readonly command: string;
    readonly required: boolean;
}
export interface TestCommandRunnerContract {
    readonly executionMode: 'delegated';
    readonly evidenceRequired: boolean;
    readonly commands: readonly TestCommandContract[];
}
export interface TestCommandResult extends TestCommandContract {
    readonly exitCode: number;
    readonly ok: boolean;
    readonly durationMs: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly signal: string | null;
}
export interface TestReportSummary {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly durationMs: number;
}
export interface TestReportMetrics {
    readonly latency?: number;
    readonly errorRate?: number;
    readonly coverage?: number | null;
    readonly edgeCaseCount?: number;
}
export interface TestReportDocument {
    readonly schemaId: 'atm.testReport';
    readonly specVersion: '0.1.0';
    readonly dataVersion?: string;
    readonly artifactVersion?: string;
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly atomId: string;
    readonly ok: boolean;
    readonly exitCode: number;
    readonly generatedAt: string;
    readonly repositoryRoot: string;
    readonly specPath: string | null;
    readonly hashLock: {
        readonly algorithm: 'sha256';
        readonly digest: string;
        readonly canonicalization: 'json-stable-v1' | 'text-normalized-v1';
    };
    readonly validation: {
        readonly evidenceRequired: boolean;
        readonly commandCount: number;
    };
    readonly runnerContract: TestCommandRunnerContract;
    readonly results: readonly TestCommandResult[];
    readonly summary: TestReportSummary;
    readonly metrics?: TestReportMetrics;
    readonly artifacts: readonly ArtifactRecord[];
    readonly evidence: readonly EvidenceRecord[];
}
export interface SourcePathsRecord {
    readonly spec: string;
    readonly code: string | readonly string[];
    readonly tests: readonly string[];
}
export interface RegistrySelfVerificationRecord {
    readonly legacyPlanningId: string | null;
    readonly specHash: string;
    readonly codeHash: string;
    readonly testHash: string;
    readonly sourcePaths: SourcePathsRecord;
}
export interface RegistryLocationRecord {
    readonly specPath: string;
    readonly codePaths: readonly string[];
    readonly testPaths: readonly string[];
    readonly reportPath: string | null;
    readonly workbenchPath: string | null;
}
export interface RegistryCompatibilityRecord {
    readonly coreVersion: string;
    readonly registryVersion: string;
    readonly pluginApiVersion?: string;
    readonly languageAdapter?: string;
    readonly lifecycleMode?: 'birth' | 'evolution';
}
export interface RegistryMapMemberRecord {
    readonly atomId: string;
    readonly version: string;
    readonly role?: 'entry-adapter' | 'domain-step' | 'validator' | 'side-effect' | 'rollback-adapter';
    readonly versionLineage?: RegistryVersionLineageRecord;
}
export interface RegistryVersionLineageRecord {
    readonly currentVersion: string;
    readonly versions: readonly RegistryVersionRecord[];
    readonly sourceRef?: string;
    readonly advisory?: string;
    readonly updatedAt?: string;
}
export interface RegistryMapEdgeRecord {
    readonly from: string;
    readonly to: string;
    readonly binding: string;
    readonly edgeKind?: 'data-flow' | 'control-flow' | 'event-flow' | 'validation' | 'fallback' | 'side-effect' | 'rollback';
}
export interface AtomicMapReplacementRecord {
    readonly legacyUris: readonly string[];
    readonly mode: 'draft' | 'shadow' | 'canary' | 'active' | 'legacy-retired';
    readonly evidenceRefs: readonly string[];
}
export type RegistryMapQualityTargetValue = string | number | boolean;
export type RegistryMapQualityTargetsRecord = Readonly<Record<string, RegistryMapQualityTargetValue>>;
export interface AtomicMapRecord {
    readonly schemaId: 'atm.atomicMap';
    readonly specVersion: '0.1.0' | '0.2.0';
    readonly dataVersion?: string;
    readonly artifactVersion?: string;
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly mapId: string;
    readonly mapVersion: string;
    readonly members: readonly RegistryMapMemberRecord[];
    readonly edges: readonly RegistryMapEdgeRecord[];
    readonly entrypoints: readonly string[];
    readonly qualityTargets: RegistryMapQualityTargetsRecord;
    readonly mapHash: string;
    readonly replacement?: AtomicMapReplacementRecord;
    readonly semanticFingerprint?: string | null;
    readonly pendingSfCalculation?: boolean;
    readonly lineageLogRef?: string;
    readonly ttl?: number;
}
export interface RegistryVersionRecord {
    readonly version: string;
    readonly specHash: string;
    readonly codeHash: string;
    readonly testHash: string;
    readonly timestamp: string;
    readonly semanticFingerprint?: string | null;
}
export type RegistryEntryStatus = 'draft' | 'validated' | 'active' | 'transitioning' | 'deprecated' | 'expired' | 'quarantined';
export type RegistryGovernanceTier = 'foundation' | 'governed' | 'standard' | 'experimental';
export interface RegistryGovernanceRecord {
    readonly tier: RegistryGovernanceTier;
}
export interface RegistryEntryRecord {
    readonly id?: string;
    readonly atomId: string;
    readonly atomVersion?: string;
    readonly currentVersion?: string;
    readonly versions?: readonly RegistryVersionRecord[];
    readonly semanticFingerprint?: string | null;
    readonly lineageLogRef?: string;
    readonly evidenceIndexRef?: string;
    readonly ttl?: number | null;
    readonly schemaId: 'atm.atomicSpec';
    readonly specVersion: string;
    readonly dataVersion?: string;
    readonly artifactVersion?: string;
    readonly schemaPath: string;
    readonly specPath: string;
    readonly hashLock: {
        readonly algorithm: 'sha256';
        readonly digest: string;
        readonly canonicalization: 'json-stable-v1' | 'text-normalized-v1';
    };
    readonly owner: {
        readonly name: string;
        readonly contact: string;
    };
    readonly status: RegistryEntryStatus;
    readonly governance: RegistryGovernanceRecord;
    readonly location?: RegistryLocationRecord;
    readonly compatibility: RegistryCompatibilityRecord;
    readonly evidence: readonly string[];
    readonly selfVerification: RegistrySelfVerificationRecord;
}
export interface MapRegistryEntryRecord extends Omit<AtomicMapRecord, 'migration'> {
    readonly schemaPath: string;
    readonly status: RegistryEntryStatus;
    readonly governance: RegistryGovernanceRecord;
    readonly location?: RegistryLocationRecord;
    readonly evidence?: readonly string[];
}
export type RegistryDocumentEntryRecord = RegistryEntryRecord | MapRegistryEntryRecord;
export interface RegistryShardingRecord {
    readonly strategy: 'single-document' | 'external-parts';
    readonly partPaths: readonly string[];
    readonly nextRegistryId: string | null;
}
export interface RegistryDocument {
    readonly schemaId: 'atm.registry';
    readonly specVersion: '0.1.0';
    readonly dataVersion?: string;
    readonly artifactVersion?: string;
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly registryId: string;
    readonly generatedAt: string;
    readonly sharding?: RegistryShardingRecord;
    readonly entries: readonly RegistryDocumentEntryRecord[];
}
export declare const corePackage: AtomicPackageDescriptor;
export * from './agent-execute/execute-agent-task.ts';
export * from './registry/map-hash.ts';
export * from './registry/map-registry.ts';
export * from './registry/status-migration.ts';
export * from './registry/status-machine.ts';
export * from './registry/semantic-fingerprint.ts';
export * from './registry/atom-runtime.ts';
export * from './registry/atom-ref-readability.ts';
export * from './registry/rollback.ts';
export * from './registry/registry-migration.ts';
export * from './guidance/index.ts';
export * from './upgrade/evolution-draft.ts';
export * from './police/family.ts';
export * from './broker/index.ts';
export * from './evidence/index.ts';
export * from './telemetry/index.ts';
export * from './batch/plan-run-journal.ts';
