import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { relativePathFrom } from './shared.ts';

export type TaskLedgerMode = 'adopter-governed' | 'framework-development' | 'external-provider';
export type TaskLedgerConfiguredMode = 'auto' | TaskLedgerMode;

export interface ExternalTaskReference {
  readonly provider: string;
  readonly taskId: string;
  readonly url?: string | null;
}

export interface TaskLedgerPolicy {
  readonly enabled: boolean;
  readonly configuredMode: TaskLedgerConfiguredMode;
  readonly provider: string;
  readonly mirrorExternalTasks: boolean;
  readonly requireCliTransitions: boolean;
  readonly taskRoot: string;
  readonly eventRoot: string;
  readonly externalTasks: readonly ExternalTaskReference[];
}

export interface TaskTransitionEvent {
  readonly schemaId: 'atm.taskTransition.v1';
  readonly specVersion: '0.1.0';
  readonly transitionId: string;
  readonly taskId: string;
  readonly action: string;
  readonly actorId: string | null;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly taskPath: string;
  readonly taskSha256: string;
  readonly createdAt: string;
  readonly command: string;
  readonly originProvider?: string;
  readonly originTaskId?: string;
  readonly closure?: TaskTransitionClosureMetadata;
}

export interface TaskTransitionRequiredGatesSnapshot {
  readonly schemaId: 'atm.requiredGatesSnapshot.v1';
  readonly generatedAt: string;
  readonly source: 'frameworkStatus.requiredGates';
  readonly ruleVersion: string;
  readonly frameworkMode: string;
  readonly repoRole: 'framework' | 'host';
  readonly changedFiles: readonly string[];
  readonly criticalChangedFiles: readonly string[];
  readonly requiredGates: readonly string[];
}

export interface TaskTransitionClosureMetadata {
  readonly schemaId: 'atm.taskClosureTransition.v1';
  readonly batchId?: string | null;
  readonly closurePacketPath: string | null;
  readonly evidenceFreshness: 'fresh' | 'historical-reference' | 'draft' | null;
  readonly validationPasses: readonly string[];
  readonly requiredGates: readonly string[];
  readonly requiredGatesSnapshot: TaskTransitionRequiredGatesSnapshot | null;
}

const defaultTaskLedgerPolicy: Omit<TaskLedgerPolicy, 'taskRoot' | 'eventRoot' | 'externalTasks'> = {
  enabled: true,
  configuredMode: 'auto',
  provider: 'atm-local',
  mirrorExternalTasks: true,
  requireCliTransitions: true
};

export function readTaskLedgerPolicy(cwd: string): TaskLedgerPolicy {
  const root = path.resolve(cwd);
  const config = readJsonIfExists(path.join(root, '.atm', 'config.json')) ?? {};
  const ledger = isPlainObject(config.taskLedger) ? config.taskLedger : {};
  const paths = isPlainObject(config.paths) ? config.paths : {};
  const configuredMode = normalizeConfiguredMode(ledger.mode);
  return {
    ...defaultTaskLedgerPolicy,
    enabled: typeof ledger.enabled === 'boolean' ? ledger.enabled : defaultTaskLedgerPolicy.enabled,
    configuredMode,
    provider: normalizeNonEmptyString(ledger.provider) ?? defaultTaskLedgerPolicy.provider,
    mirrorExternalTasks: typeof ledger.mirrorExternalTasks === 'boolean'
      ? ledger.mirrorExternalTasks
      : defaultTaskLedgerPolicy.mirrorExternalTasks,
    requireCliTransitions: typeof ledger.requireCliTransitions === 'boolean'
      ? ledger.requireCliTransitions
      : defaultTaskLedgerPolicy.requireCliTransitions,
    taskRoot: normalizeNonEmptyString(paths.tasks) ?? '.atm/history/tasks',
    eventRoot: normalizeNonEmptyString(paths.taskEvents) ?? '.atm/history/task-events',
    externalTasks: normalizeExternalTasks(ledger.externalTasks)
  };
}

export function resolveTaskLedgerMode(input: {
  readonly policy: TaskLedgerPolicy;
  readonly frameworkMode: string;
  readonly repoRole: string;
  readonly closureAuthority: string;
}): TaskLedgerMode {
  if (!input.policy.enabled || input.policy.provider !== 'atm-local') {
    return 'external-provider';
  }
  if (input.policy.configuredMode !== 'auto') {
    return input.policy.configuredMode;
  }
  if (input.frameworkMode === 'required' || input.frameworkMode === 'cross-repo-target-required') {
    return 'framework-development';
  }
  return 'adopter-governed';
}

export function appendTaskTransitionEvent(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly action: string;
  readonly actorId?: string | null;
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly taskPath: string;
  readonly taskDocument: Record<string, unknown>;
  readonly command?: string;
  readonly closureMetadata?: TaskTransitionClosureMetadata | null;
}): { transitionId: string; eventPath: string; event: TaskTransitionEvent } {
  const root = path.resolve(input.cwd);
  const policy = readTaskLedgerPolicy(root);
  const createdAt = new Date().toISOString();
  const taskJson = `${JSON.stringify(input.taskDocument, null, 2)}\n`;
  const seed = `${createdAt}\n${input.taskId}\n${input.action}\n${taskJson}`;
  const transitionId = `${createdAt.replace(/[:.]/g, '-')}-${input.action}-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
  const eventRoot = path.join(root, policy.eventRoot, sanitizeTaskId(input.taskId));
  const eventAbsolute = path.join(eventRoot, `${transitionId}.json`);
  const event: TaskTransitionEvent = {
    schemaId: 'atm.taskTransition.v1',
    specVersion: '0.1.0',
    transitionId,
    taskId: input.taskId,
    action: input.action,
    actorId: input.actorId ?? null,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    taskPath: relativePathFrom(root, input.taskPath),
    taskSha256: sha256(taskJson),
    createdAt,
    command: input.command ?? `atm tasks ${input.action}`,
    ...(typeof input.taskDocument.originProvider === 'string' ? { originProvider: input.taskDocument.originProvider } : {}),
    ...(typeof input.taskDocument.originTaskId === 'string' ? { originTaskId: input.taskDocument.originTaskId } : {}),
    ...(input.closureMetadata ? { closure: input.closureMetadata } : {})
  };
  mkdirSync(eventRoot, { recursive: true });
  writeFileSync(eventAbsolute, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
  return {
    transitionId,
    eventPath: relativePathFrom(root, eventAbsolute),
    event
  };
}

export function transitionEventExists(cwd: string, taskId: string, transitionId: string): boolean {
  const root = path.resolve(cwd);
  const policy = readTaskLedgerPolicy(root);
  return existsSync(path.join(root, policy.eventRoot, sanitizeTaskId(taskId), `${transitionId}.json`));
}

export function externalTaskKey(provider: string, taskId: string): string {
  return `${provider.trim().toLowerCase()}::${taskId.trim().toLowerCase()}`;
}

export function defaultMirrorTaskId(provider: string, originTaskId: string): string {
  const providerToken = provider.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'EXT';
  const originToken = originTaskId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'TASK';
  return `MIRROR-${providerToken}-${originToken}`;
}

function normalizeConfiguredMode(value: unknown): TaskLedgerConfiguredMode {
  const normalized = String(value ?? 'auto').trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'adopter-governed' || normalized === 'framework-development' || normalized === 'external-provider') {
    return normalized;
  }
  return 'auto';
}

function normalizeExternalTasks(value: unknown): readonly ExternalTaskReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) return [];
    const provider = normalizeNonEmptyString(entry.provider);
    const taskId = normalizeNonEmptyString(entry.taskId ?? entry.originTaskId);
    if (!provider || !taskId) return [];
    return [{
      provider,
      taskId,
      url: normalizeNonEmptyString(entry.url ?? entry.originUrl)
    }];
  });
}

function readJsonIfExists(filePath: string): Record<string, any> | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, any>;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeTaskId(taskId: string): string {
  return taskId.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
