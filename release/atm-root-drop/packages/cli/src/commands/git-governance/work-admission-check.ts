import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readFrameworkTempLockProjection } from '../framework-development/framework-temp-lock-projection.ts';
import {
  checkWorkAdmissionTicket,
  createWorkAdmissionCoverageReceipt,
  issueWorkAdmissionTicket,
  type WorkAdmissionOperation,
  type WorkAdmissionTicket,
  type WorkAdmissionTicketDecision
} from '../../../../core/src/broker/work-admission-ticket.ts';
import { pathMatchesWriteScope } from '../../../../core/src/broker/write-scope-policy.ts';

export interface WorkAdmissionGateResult {
  readonly decision: WorkAdmissionTicketDecision;
  readonly receipt: ReturnType<typeof createWorkAdmissionCoverageReceipt> | null;
}

/**
 * Boundary adapter for the single claim-issued authority.  It deliberately
 * owns no policy: callers supply the observed operation/files and receive the
 * authority decision plus an attributable coverage receipt.
 */
export function evaluateWorkAdmissionGate(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly claimGeneration?: string | null;
  readonly operation: WorkAdmissionOperation;
  readonly files: readonly string[];
  readonly producingAtmCommand: string;
  readonly observedContent?: string;
  readonly now?: string;
}): WorkAdmissionGateResult {
  const ticket = resolveWorkAdmissionTicket(input);
  const decision = checkWorkAdmissionTicket({
    ticket,
    taskId: input.taskId,
    actorId: input.actorId,
    laneSessionId: input.laneSessionId,
    claimGeneration: input.claimGeneration,
    files: input.files,
    operation: input.operation,
    now: input.now
  });
  if (!decision.ok || !ticket) return { decision, receipt: null };
  const receipt = createWorkAdmissionCoverageReceipt({
    ticket,
    operation: input.operation,
    path: input.files[0] ?? '.',
    observedContent: input.observedContent ?? JSON.stringify({ operation: input.operation, files: [...input.files].sort() }),
    producingAtmCommand: input.producingAtmCommand,
    now: input.now
  });
  return { decision, receipt };
}

function issueFrameworkTempAdmissionTicket(input: Parameters<typeof evaluateWorkAdmissionGate>[0]): WorkAdmissionTicket | null {
  const now = input.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const lock = readFrameworkTempLockProjection(input.cwd, nowMs).find((candidate) =>
    candidate.workItemId === input.taskId
    && candidate.actorId === input.actorId
    && candidate.disposition === 'foreign-live'
    && input.files.every((file) => candidate.files.some((scope) => pathMatchesWriteScope(file, scope)))
  );
  if (!lock || lock.ttlSeconds === null || lock.heartbeatAt === null) return null;
  const remainingSeconds = Math.max(1, Math.floor((Date.parse(lock.heartbeatAt) + lock.ttlSeconds * 1000 - nowMs) / 1000));
  return issueWorkAdmissionTicket({
    taskId: lock.workItemId,
    actorId: lock.actorId,
    laneSessionId: lock.laneSessionId,
    claimGeneration: `framework-lock:${lock.heartbeatAt}`,
    allowedFiles: lock.files,
    runnerSelection: { runnerKind: 'frozen', runnerRef: 'framework-mode-lock', selectedAt: now },
    now,
    ttlSeconds: remainingSeconds
  });
}

export function resolveWorkAdmissionTicket(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly laneSessionId?: string | null;
  readonly claimGeneration?: string | null;
  readonly operation: WorkAdmissionOperation;
  readonly files: readonly string[];
  readonly producingAtmCommand: string;
  readonly observedContent?: string;
  readonly now?: string;
}): WorkAdmissionTicket | null {
  return readWorkAdmissionTicket(input.cwd, input.taskId)
    ?? issueLegacyActiveTaskAdmissionTicket(input)
    ?? issueFrameworkTempAdmissionTicket(input);
}

function issueLegacyActiveTaskAdmissionTicket(input: Parameters<typeof evaluateWorkAdmissionGate>[0]): WorkAdmissionTicket | null {
  const task = readTaskDocument(input.cwd, input.taskId);
  const claim = task?.claim;
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return null;
  const record = claim as Record<string, unknown>;
  if (String(record.state ?? '').trim().toLowerCase() !== 'active') return null;
  const actorId = typeof record.actorId === 'string' ? record.actorId.trim() : '';
  const claimGeneration = typeof record.leaseId === 'string' ? record.leaseId.trim() : '';
  if (!actorId || actorId !== input.actorId || !claimGeneration) return null;
  const allowedFiles = resolveLegacyTaskAdmissionFiles(task, input.taskId);
  if (allowedFiles.length === 0) return null;
  const lane = record.laneSession && typeof record.laneSession === 'object'
    ? record.laneSession as Record<string, unknown>
    : null;
  const laneSessionId = typeof lane?.laneSessionId === 'string'
    ? lane.laneSessionId
    : (typeof lane?.laneId === 'string' ? lane.laneId : null);
  return issueWorkAdmissionTicket({
    taskId: input.taskId,
    actorId,
    laneSessionId,
    claimGeneration,
    allowedFiles,
    runnerSelection: {
      runnerKind: 'frozen',
      runnerRef: 'legacy-active-claim',
      selectedAt: input.now ?? new Date().toISOString()
    },
    now: input.now,
    ttlSeconds: positiveInteger(record.ttlSeconds, 3600)
  });
}

/**
 * Normal boundary entrypoint.  Claim identity comes from the ledger sealed by
 * the claim path, so commit/close/push callers cannot invent a parallel actor
 * or lane interpretation.
 */
export function evaluateTaskWorkAdmissionGate(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly operation: WorkAdmissionOperation;
  readonly files: readonly string[];
  readonly producingAtmCommand: string;
  readonly observedContent?: string;
  readonly now?: string;
}): WorkAdmissionGateResult {
  const task = readTaskAdmissionContext(input.cwd, input.taskId);
  const frameworkTemp = task ? null : readFrameworkTempLockProjection(input.cwd).find((candidate) =>
    candidate.workItemId === input.taskId
    && candidate.disposition === 'foreign-live'
    && input.files.every((file) => candidate.files.some((scope) => pathMatchesWriteScope(file, scope)))
  );
  return evaluateWorkAdmissionGate({
    ...input,
    actorId: task?.actorId ?? frameworkTemp?.actorId ?? '',
    laneSessionId: task?.laneSessionId ?? frameworkTemp?.laneSessionId ?? null,
    claimGeneration: task?.claimGeneration ?? (frameworkTemp?.heartbeatAt ? `framework-lock:${frameworkTemp.heartbeatAt}` : null)
  });
}

export function readWorkAdmissionTicket(cwd: string, taskId: string): WorkAdmissionTicket | null {
  const task = readTaskDocument(cwd, taskId);
  return task && isTicket(task.workAdmissionTicket) ? task.workAdmissionTicket : null;
}

function readTaskAdmissionContext(cwd: string, taskId: string): { actorId: string; laneSessionId: string | null; claimGeneration: string | null } | null {
  const task = readTaskDocument(cwd, taskId);
  const claim = task?.claim;
  if (!claim || typeof claim !== 'object') return null;
  const record = claim as Record<string, unknown>;
  const lane = record.laneSession && typeof record.laneSession === 'object'
    ? record.laneSession as Record<string, unknown>
    : null;
  return {
    actorId: typeof record.actorId === 'string' ? record.actorId : '',
    laneSessionId: typeof lane?.laneSessionId === 'string' ? lane.laneSessionId : (typeof lane?.laneId === 'string' ? lane.laneId : null),
    claimGeneration: typeof record.leaseId === 'string' ? record.leaseId : null
  };
}

function readTaskDocument(cwd: string, taskId: string): {
  workAdmissionTicket?: unknown;
  claim?: unknown;
  taskDirectionLock?: unknown;
  scopePaths?: unknown;
  deliverables?: unknown;
} | null {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return null;
  try {
    return JSON.parse(readFileSync(taskPath, 'utf8')) as {
      workAdmissionTicket?: unknown;
      claim?: unknown;
      taskDirectionLock?: unknown;
      scopePaths?: unknown;
      deliverables?: unknown;
    };
  } catch {
    return null;
  }
}

function resolveLegacyTaskAdmissionFiles(task: {
  taskDirectionLock?: unknown;
  scopePaths?: unknown;
  deliverables?: unknown;
  claim?: unknown;
}, taskId: string): readonly string[] {
  const directionLock = task.taskDirectionLock && typeof task.taskDirectionLock === 'object' && !Array.isArray(task.taskDirectionLock)
    ? task.taskDirectionLock as Record<string, unknown>
    : null;
  const claim = task.claim && typeof task.claim === 'object' && !Array.isArray(task.claim)
    ? task.claim as Record<string, unknown>
    : null;
  const declaredFiles = Array.isArray(directionLock?.allowedFiles)
    ? directionLock.allowedFiles.map(String)
    : Array.isArray(task.scopePaths)
      ? task.scopePaths.map(String)
      : Array.isArray(task.deliverables)
        ? task.deliverables.map(String)
        : Array.isArray(claim?.files)
          ? claim.files.map(String)
          : [];
  return [...new Set([
    ...declaredFiles.map((entry) => entry.trim()).filter(Boolean),
    '.atm/history/evidence/git-head.jsonl',
    `.atm/history/evidence/${taskId}.*`,
    `.atm/history/task-events/${taskId}/**`,
    `.atm/history/tasks/${taskId}.json`
  ])];
}

function isTicket(value: unknown): value is WorkAdmissionTicket {
  return Boolean(value && typeof value === 'object'
    && (value as { schemaId?: unknown }).schemaId === 'atm.workAdmissionTicket.v1');
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
