import { pathMatchesWriteScope } from '../../../../core/src/broker/write-scope-policy.ts';
import { existsSync, statSync } from 'node:fs';
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
}

/** Resolves the framework-only commit surface without exposing lock details to callers. */
export function resolveFrameworkCommitAuthorityContext(input: {
  readonly cwd: string;
  readonly taskId: string | null | undefined;
  readonly actorId: string;
  readonly taskExists: boolean;
}): FrameworkCommitAuthorityContext {
  const capability = input.taskExists ? null : resolveFrameworkTempPublicationCapability(input);
  return {
    usesFrameworkClaimCommit: !input.taskExists || capability !== null,
    frameworkClaimFiles: capability?.allowedFiles ?? null,
  };
}

export function resolveFrameworkTempPublicationCapability(input: {
  readonly cwd: string;
  readonly taskId: string | null | undefined;
  readonly actorId?: string | null;
  readonly now?: number;
}): FrameworkTempPublicationCapability | null {
  const taskId = input.taskId?.trim();
  const actorId = input.actorId?.trim() ?? '';
  if (!taskId) return null;
  const lock = readFrameworkTempLockProjection(input.cwd, input.now).find(
    (candidate) =>
      candidate.workItemId === taskId &&
      (!actorId || candidate.actorId === actorId) &&
      candidate.disposition === 'foreign-live',
  );
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
      ...(lock.linkedTaskId
        ? [`.atm/history/evidence/${lock.linkedTaskId}.runner-sync-receipt.json`]
        : []),
    ],
  };
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
