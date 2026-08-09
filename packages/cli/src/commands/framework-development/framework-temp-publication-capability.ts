import { pathMatchesWriteScope } from '../../../../core/src/broker/write-scope-policy.ts';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  readFrameworkTempLockProjection,
  type FrameworkTempLockProjection,
} from './framework-temp-lock-projection.ts';

/**
 * Resolves the one lock-backed authority that can publish a temporary
 * framework build.  Consumers receive capability facts only; they must not
 * infer authority from a task-id prefix, an actor's other locks, or generated
 * output paths.
 */
export interface FrameworkTempPublicationCapability {
  readonly taskId: string;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly heartbeatAt: string;
  readonly ttlSeconds: number;
  readonly allowedFiles: readonly string[];
}

export interface FrameworkCommitAuthorityContext {
  readonly usesFrameworkClaimCommit: boolean;
  readonly frameworkClaimFiles: readonly string[] | null;
  /** The exact live lock identity used by hook attribution; never reconstruct it from an actor id. */
  readonly frameworkClaimTaskId: string | null;
}

/** Resolves the framework-only commit surface without exposing lock details to callers. */
export function resolveFrameworkCommitAuthorityContext(input: {
  readonly cwd: string;
  readonly taskId: string | null | undefined;
  readonly actorId: string;
  readonly taskExists: boolean;
}): FrameworkCommitAuthorityContext {
  const capability = input.taskExists ? null : resolveFrameworkTempPublicationCapability({
    ...input,
    laneSessionId: process.env.ATM_LANE_SESSION_ID ?? null,
  });
  return {
    usesFrameworkClaimCommit: !input.taskExists || capability !== null,
    frameworkClaimFiles: capability?.allowedFiles ?? null,
    frameworkClaimTaskId: capability?.taskId ?? null,
  };
}

export function resolveFrameworkTempPublicationCapability(input: {
  readonly cwd: string;
  readonly taskId: string | null | undefined;
  readonly actorId?: string | null;
  /** A no-task framework commit must bind to its current lane, never another
   * live claim held by the same actor. */
  readonly laneSessionId?: string | null;
  readonly now?: number;
}): FrameworkTempPublicationCapability | null {
  const taskId = input.taskId?.trim();
  const actorId = input.actorId?.trim() ?? '';
  const laneSessionId = input.laneSessionId?.trim() ?? '';
  const candidates = readFrameworkTempLockProjection(input.cwd, input.now).filter(
    (candidate) =>
      (!taskId || candidate.workItemId === taskId) &&
      (!actorId || candidate.actorId === actorId) &&
      (!laneSessionId || candidate.laneSessionId === laneSessionId) &&
      candidate.disposition === 'foreign-live',
  );
  // A task id already provides a canonical authority key.  A taskless
  // publication must instead be unique after lane binding; guessing among an
  // actor's other live claims would permit receipt/lock identity drift.
  const lock = candidates.length === 1 ? candidates[0] : null;
  return lock ? toCapability(input.cwd, lock) : null;
}

export function frameworkTempPublicationCapabilityCovers(
  capability: FrameworkTempPublicationCapability | null,
  files: readonly string[],
): boolean {
  return Boolean(
    capability &&
      files.every((file) =>
        capability.allowedFiles.some((scope) => pathMatchesWriteScope(file, scope)),
      ),
  );
}

function toCapability(cwd: string, lock: FrameworkTempLockProjection): FrameworkTempPublicationCapability | null {
  if (!lock.heartbeatAt || lock.ttlSeconds === null) return null;
  return {
    taskId: lock.workItemId,
    actorId: lock.actorId,
    laneSessionId: lock.laneSessionId,
    heartbeatAt: lock.heartbeatAt,
    ttlSeconds: lock.ttlSeconds,
    // A runner-sync receipt is part of the sealed publication proof, not
    // optional residue. Keep this derivation at the capability boundary so
    // callers cannot accidentally publish bytes without their receipt.
    allowedFiles: [
      ...lock.files.map((scope) => normalizeDirectoryScope(cwd, scope)),
      `.atm/history/evidence/${lock.workItemId}.runner-sync-receipt.json`,
      ...(lock.linkedTaskId
        ? [`.atm/history/evidence/${lock.linkedTaskId}.runner-sync-receipt.json`]
        : []),
      ...resolveQueueBoundTerminalReceiptPaths(cwd, lock),
    ],
  };
}

/**
 * A completed task has no live task lease.  It may nevertheless retain one
 * narrow publication continuation when a live framework lock, queue-head and
 * sealed receipt all agree.  This derives capability from durable facts rather
 * than treating a terminal task as generally writable.
 */
function resolveQueueBoundTerminalReceiptPaths(cwd: string, lock: FrameworkTempLockProjection): readonly string[] {
  const queuePath = path.join(cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json');
  if (!existsSync(queuePath)) return [];
  try {
    const queue = JSON.parse(readFileSync(queuePath, 'utf8')) as { groups?: unknown };
    if (!Array.isArray(queue.groups)) return [];
    return queue.groups.flatMap((group): string[] => {
      if (!group || typeof group !== 'object') return [];
      const candidate = group as Record<string, unknown>;
      if (candidate.queuePosition !== 1 || typeof candidate.stewardWorkId !== 'string' || typeof candidate.sealedSourceSha !== 'string' || !Array.isArray(candidate.requests)) return [];
      return candidate.requests.flatMap((request): string[] => {
        if (!request || typeof request !== 'object') return [];
        const entry = request as Record<string, unknown>;
        const taskId = typeof entry.taskId === 'string' ? entry.taskId.trim() : '';
        if (!taskId || entry.actorId !== lock.actorId || entry.sealedSourceSha !== candidate.sealedSourceSha || !isTerminalTask(cwd, taskId)) return [];
        const receiptPath = `.atm/history/evidence/${taskId}.runner-sync-receipt.json`;
        const receipt = readQueueBoundReceipt(cwd, receiptPath);
        return receipt
          && receipt.taskId === taskId
          && receipt.actorId === lock.actorId
          && receipt.stewardWorkId === candidate.stewardWorkId
          && receipt.sealedSourceSha === candidate.sealedSourceSha
          ? [receiptPath]
          : [];
      });
    });
  } catch {
    return [];
  }
}

function isTerminalTask(cwd: string, taskId: string): boolean {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return false;
  try {
    const task = JSON.parse(readFileSync(taskPath, 'utf8')) as { status?: unknown };
    return task.status === 'done' || task.status === 'review' || task.status === 'abandoned';
  } catch {
    return false;
  }
}

function readQueueBoundReceipt(cwd: string, receiptPath: string): Record<string, unknown> | null {
  const absolute = path.join(cwd, receiptPath);
  if (!existsSync(absolute)) return null;
  try {
    const receipt = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
    return receipt.schemaId === 'atm.runnerSyncReceipt.v1' ? receipt : null;
  } catch {
    return null;
  }
}

function normalizeDirectoryScope(cwd: string, scope: string): string {
  if (scope.endsWith('/**')) return scope;
  const absolute = path.join(cwd, scope);
  try {
    return existsSync(absolute) && statSync(absolute).isDirectory()
      ? `${scope}/**`
      : scope;
  } catch {
    return scope;
  }
}
