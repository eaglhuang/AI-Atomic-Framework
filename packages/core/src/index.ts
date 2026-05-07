export type AtomLifecycleStatus = 'planned' | 'locked' | 'running' | 'verified' | 'done' | 'blocked';

export interface AtomicPackageDescriptor {
  readonly packageName: string;
  readonly packageRole: string;
  readonly packageVersion: string;
}

export interface WorkItemRef {
  readonly workItemId: string;
  readonly title: string;
  readonly status: AtomLifecycleStatus;
}

export interface ScopeLockRecord {
  readonly workItemId: string;
  readonly lockedBy: string;
  readonly lockedAt: string;
  readonly files: readonly string[];
}

export interface ArtifactRecord {
  readonly artifactPath: string;
  readonly artifactKind: 'file' | 'log' | 'report' | 'snapshot';
  readonly producedBy: string;
}

export interface EvidenceRecord {
  readonly evidenceKind: 'validation' | 'review' | 'metric' | 'handoff';
  readonly summary: string;
  readonly artifactPaths: readonly string[];
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
}

export interface RegistryMapEdgeRecord {
  readonly from: string;
  readonly to: string;
  readonly binding: string;
}

export type RegistryMapQualityTargetValue = string | number | boolean;

export type RegistryMapQualityTargetsRecord = Readonly<Record<string, RegistryMapQualityTargetValue>>;

export interface AtomicMapRecord {
  readonly schemaId: 'atm.atomicMap';
  readonly specVersion: '0.1.0';
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
  readonly semanticFingerprint?: string;
  readonly lineageLogRef?: string;
  readonly ttl?: number;
}

export interface RegistryVersionRecord {
  readonly version: string;
  readonly specHash: string;
  readonly codeHash: string;
  readonly testHash: string;
  readonly timestamp: string;
}

export interface RegistryEntryRecord {
  readonly id?: string;
  readonly atomId: string;
  readonly atomVersion?: string;
  readonly currentVersion?: string;
  readonly versions?: readonly RegistryVersionRecord[];
  readonly schemaId: 'atm.atomicSpec';
  readonly specVersion: string;
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
  readonly status: 'seed' | 'active' | 'experimental' | 'deprecated' | 'governed';
  readonly location?: RegistryLocationRecord;
  readonly compatibility: RegistryCompatibilityRecord;
  readonly evidence: readonly string[];
  readonly selfVerification: RegistrySelfVerificationRecord;
}

export interface MapRegistryEntryRecord extends Omit<AtomicMapRecord, 'migration'> {
  readonly schemaPath: string;
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

export interface ContextSummaryRecord {
  readonly workItemId: string;
  readonly summary: string;
  readonly nextActions: readonly string[];
}

export const corePackage: AtomicPackageDescriptor = {
  packageName: '@ai-atomic-framework/core',
  packageRole: 'core-contracts',
  packageVersion: '0.0.0'
};

export * from './registry/map-hash.ts';
export * from './registry/map-registry.ts';
export * from './registry/registry-migration.ts';