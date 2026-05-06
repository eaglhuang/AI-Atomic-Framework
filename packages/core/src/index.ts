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
  readonly artifacts: readonly ArtifactRecord[];
  readonly evidence: readonly EvidenceRecord[];
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