import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SharedSurfaceQueue } from '../../../../core/src/broker/shared-surface-queue.ts';

export type BrokerQueueAdmission = {
  readonly schemaId: 'atm.brokerQueueAdmission.v1';
  readonly taskId: string;
  readonly status: 'not-queued' | 'queue-head' | 'queued-private-work' | 'queued-blocked' | 'invalid';
  readonly allowedFiles: readonly string[];
  readonly queuedSharedPaths: readonly string[];
  readonly waitingOn: readonly { readonly surfacePath: string; readonly queueHeadTaskId: string; readonly position: number }[];
  readonly reason: string;
};

export function evaluateBrokerQueueAdmission(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly allowedFiles: readonly string[];
  readonly overlappingFiles: readonly string[];
}): BrokerQueueAdmission {
  const allowedFiles = uniquePaths(input.allowedFiles);
  const queues = readQueues(input.cwd);
  if (!queues.ok) return invalid(input.taskId, allowedFiles, queues.reason);
  const relevant = queues.value.filter((queue) => queue.entries.some((entry) => entry.taskId === input.taskId));
  if (relevant.length === 0) return {
    schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId, status: 'not-queued', allowedFiles,
    queuedSharedPaths: [], waitingOn: [], reason: 'No canonical shared-surface queue entry exists for this claim.'
  };
  const overlapping = new Set(uniquePaths(input.overlappingFiles));
  const waitingOn = relevant.flatMap((queue) => {
    const position = queue.entries.findIndex((entry) => entry.taskId === input.taskId) + 1;
    const head = queue.entries[0];
    return head && head.taskId !== input.taskId ? [{ surfacePath: queue.surfacePath, queueHeadTaskId: head.taskId, position }] : [];
  });
  const queuedSharedPaths = uniquePaths(waitingOn.map((entry) => entry.surfacePath).filter((entry) => overlapping.has(entry) || allowedFiles.includes(entry)));
  if (waitingOn.length === 0) return {
    schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId, status: 'queue-head', allowedFiles,
    queuedSharedPaths: [], waitingOn: [], reason: 'Task is head of every canonical shared-surface queue it holds.'
  };
  const privateFiles = allowedFiles.filter((file) => !queuedSharedPaths.includes(file));
  if (privateFiles.length > 0) return {
    schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId, status: 'queued-private-work', allowedFiles: privateFiles,
    queuedSharedPaths, waitingOn, reason: 'Shared paths remain queued; the task may claim only its disjoint private paths.'
  };
  return {
    schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId, status: 'queued-blocked', allowedFiles: [],
    queuedSharedPaths, waitingOn, reason: 'Every writable path for this task is behind a canonical shared-surface queue head.'
  };
}

function readQueues(cwd: string): { ok: true; value: SharedSurfaceQueue[] } | { ok: false; reason: string } {
  const filePath = path.join(cwd, '.atm', 'runtime', 'broker-shared-surface-queues.json');
  if (!existsSync(filePath)) return { ok: true, value: [] };
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { queues?: unknown };
    if (!Array.isArray(parsed.queues) || !parsed.queues.every(isQueue)) return { ok: false, reason: 'Canonical shared-surface queue document is malformed.' };
    return { ok: true, value: parsed.queues };
  } catch {
    return { ok: false, reason: 'Canonical shared-surface queue document cannot be read.' };
  }
}

function isQueue(value: unknown): value is SharedSurfaceQueue {
  return Boolean(value) && typeof value === 'object' && (value as SharedSurfaceQueue).schemaId === 'atm.brokerSharedSurfaceQueue.v1'
    && typeof (value as SharedSurfaceQueue).surfacePath === 'string' && Array.isArray((value as SharedSurfaceQueue).entries);
}

function invalid(taskId: string, allowedFiles: readonly string[], reason: string): BrokerQueueAdmission {
  return { schemaId: 'atm.brokerQueueAdmission.v1', taskId, status: 'invalid', allowedFiles, queuedSharedPaths: [], waitingOn: [], reason };
}

function uniquePaths(values: readonly string[]) {
  return [...new Set(values.map((value) => String(value).trim().replace(/\\/g, '/')).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
