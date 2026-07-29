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
    && input.files.every((file) => candidate.files.some((scope) => file === scope || file.startsWith(`${scope.replace(/\*\*$/, '').replace(/\*$/, '')}`)))
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
    ?? issueFrameworkTempAdmissionTicket(input);
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
  return evaluateWorkAdmissionGate({
    ...input,
    actorId: task?.actorId ?? '',
    laneSessionId: task?.laneSessionId ?? null,
    claimGeneration: task?.claimGeneration ?? null
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

function readTaskDocument(cwd: string, taskId: string): { workAdmissionTicket?: unknown; claim?: unknown } | null {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return null;
  try {
    return JSON.parse(readFileSync(taskPath, 'utf8')) as { workAdmissionTicket?: unknown; claim?: unknown };
  } catch {
    return null;
  }
}

function isTicket(value: unknown): value is WorkAdmissionTicket {
  return Boolean(value && typeof value === 'object'
    && (value as { schemaId?: unknown }).schemaId === 'atm.workAdmissionTicket.v1');
}
