import type {
  ArtifactRecord,
  ContextSummaryRecord,
  EvidenceRecord,
  RegistryDocument,
  RegistryEntryRecord,
  ScopeLockRecord,
  WorkItemRef
} from '@ai-atomic-framework/core';
import type { CapabilityResult } from '../capability';

export interface StoreLifecycle {
  initialize?(): Promise<CapabilityResult> | CapabilityResult;
  healthCheck?(): Promise<CapabilityResult> | CapabilityResult;
  dispose?(): Promise<CapabilityResult> | CapabilityResult;
}

export interface TaskStore extends StoreLifecycle {
  createTask(workItem: WorkItemRef): Promise<WorkItemRef> | WorkItemRef;
  getTask(workItemId: string): Promise<WorkItemRef | null> | WorkItemRef | null;
  updateTaskStatus(workItemId: string, status: WorkItemRef['status']): Promise<WorkItemRef> | WorkItemRef;
  listTasks(): Promise<readonly WorkItemRef[]> | readonly WorkItemRef[];
}

export interface LockStore extends StoreLifecycle {
  acquireLock(workItem: WorkItemRef, files: readonly string[], actor: string): Promise<ScopeLockRecord> | ScopeLockRecord;
  getLock(workItemId: string): Promise<ScopeLockRecord | null> | ScopeLockRecord | null;
  releaseLock(workItemId: string, actor: string): Promise<CapabilityResult> | CapabilityResult;
}

export interface DocumentIndex extends StoreLifecycle {
  resolveDocumentId(documentId: string): Promise<string | null> | string | null;
  searchDocuments(query: string): Promise<readonly string[]> | readonly string[];
  updateDocument(path: string, metadata: Readonly<Record<string, unknown>>): Promise<CapabilityResult> | CapabilityResult;
}

export interface ShardStore extends StoreLifecycle {
  readShard(path: string): Promise<unknown> | unknown;
  writeShard(path: string, value: unknown): Promise<CapabilityResult> | CapabilityResult;
  rebuildIndex(indexPath: string): Promise<CapabilityResult> | CapabilityResult;
}

export interface ArtifactStore extends StoreLifecycle {
  writeArtifact(record: ArtifactRecord, content: string | Uint8Array): Promise<ArtifactRecord> | ArtifactRecord;
  listArtifacts(workItemId: string): Promise<readonly ArtifactRecord[]> | readonly ArtifactRecord[];
}

export interface LogStore extends StoreLifecycle {
  appendLog(workItemId: string, message: string): Promise<CapabilityResult> | CapabilityResult;
  readLog(workItemId: string): Promise<string> | string;
}

export interface RunReportStore extends StoreLifecycle {
  writeRunReport(reportId: string, report: Readonly<Record<string, unknown>>): Promise<CapabilityResult> | CapabilityResult;
  readRunReport(reportId: string): Promise<Readonly<Record<string, unknown>> | null> | Readonly<Record<string, unknown>> | null;
}

export interface MarkdownJsonStateStore extends StoreLifecycle {
  readMarkdown(path: string): Promise<string> | string;
  writeMarkdown(path: string, content: string): Promise<CapabilityResult> | CapabilityResult;
  readJson(path: string): Promise<unknown> | unknown;
  writeJson(path: string, value: unknown): Promise<CapabilityResult> | CapabilityResult;
}

export interface RuleGuard extends StoreLifecycle {
  runGuard(guardId: string, context: Readonly<Record<string, unknown>>): Promise<CapabilityResult> | CapabilityResult;
}

export interface EvidenceStore extends StoreLifecycle {
  writeEvidence(workItemId: string, evidence: EvidenceRecord): Promise<EvidenceRecord> | EvidenceRecord;
  listEvidence(workItemId: string): Promise<readonly EvidenceRecord[]> | readonly EvidenceRecord[];
}

export interface RegistryStore extends StoreLifecycle {
  readRegistry(): Promise<RegistryDocument> | RegistryDocument;
  writeRegistryEntry(entry: RegistryEntryRecord): Promise<RegistryEntryRecord> | RegistryEntryRecord;
}

export interface ContextSummaryStore extends StoreLifecycle {
  writeSummary(summary: ContextSummaryRecord): Promise<ContextSummaryRecord> | ContextSummaryRecord;
  readSummary(workItemId: string): Promise<ContextSummaryRecord | null> | ContextSummaryRecord | null;
}

export type ContextBudgetDecision = 'pass' | 'summarize-before-continue' | 'hard-stop';

export interface ContextBudgetPolicy {
  readonly policyId: string;
  readonly generatedAt: string;
  readonly unit: 'tokens';
  readonly warningTokens: number;
  readonly summarizeTokens: number;
  readonly hardStopTokens: number;
  readonly maxInlineArtifacts: number;
  readonly defaultSummary: string;
}

export interface ContextBudgetEvaluationInput {
  readonly budgetId: string;
  readonly workItemId?: string;
  readonly estimatedTokens: number;
  readonly inlineArtifacts?: number;
  readonly requestedSummary?: string;
}

export interface ContextBudgetEvaluationResult {
  readonly policyId: string;
  readonly budgetId: string;
  readonly decision: ContextBudgetDecision;
  readonly estimatedTokens: number;
  readonly inlineArtifacts: number;
  readonly generatedAt: string;
  readonly reason: string;
  readonly reportPath: string;
  readonly summaryPath?: string;
}

export interface ContextBudgetGuard extends StoreLifecycle {
  readPolicy(policyId?: string): Promise<ContextBudgetPolicy | null> | ContextBudgetPolicy | null;
  writePolicy(policy: ContextBudgetPolicy): Promise<ContextBudgetPolicy> | ContextBudgetPolicy;
  evaluateBudget(input: ContextBudgetEvaluationInput): Promise<ContextBudgetEvaluationResult> | ContextBudgetEvaluationResult;
}

export interface GovernanceStores {
  readonly taskStore: TaskStore;
  readonly lockStore: LockStore;
  readonly documentIndex: DocumentIndex;
  readonly shardStore: ShardStore;
  readonly artifactStore: ArtifactStore;
  readonly logStore: LogStore;
  readonly runReportStore?: RunReportStore;
  readonly stateStore: MarkdownJsonStateStore;
  readonly ruleGuard: RuleGuard;
  readonly evidenceStore: EvidenceStore;
  readonly registryStore?: RegistryStore;
  readonly contextBudgetGuard?: ContextBudgetGuard;
  readonly contextSummaryStore?: ContextSummaryStore;
}