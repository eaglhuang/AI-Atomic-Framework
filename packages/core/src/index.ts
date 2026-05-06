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