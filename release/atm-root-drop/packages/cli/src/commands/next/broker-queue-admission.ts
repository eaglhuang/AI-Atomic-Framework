import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SharedSurfaceQueue } from '../../../../core/src/broker/shared-surface-queue.ts';
import { loadRegistry } from '../../../../core/src/broker/registry.ts';
import { pendingSerialTickets } from '../../../../core/src/broker/serial-queue/policy.ts';
import { observeSerialTicket } from '../../../../core/src/broker/serial-queue/queue.ts';
import { resourceListsOverlap } from '../../../../core/src/broker/resource-overlap.ts';

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
  const registryPath = path.join(input.cwd, '.atm/runtime/write-broker.registry.json');
  if (existsSync(registryPath)) {
    try {
      const registry = loadRegistry(registryPath, { persistCleanup: false });
      const ticket = pendingSerialTickets(registry).find((entry) => entry.taskId === input.taskId);
      if (ticket) {
        const queuedSharedPaths = allowedFiles.filter((file) => resourceListsOverlap('file', [file], ticket.intent.targetFiles));
        if (queuedSharedPaths.length > 0) {
          const privateFiles = allowedFiles.filter((file) => !queuedSharedPaths.includes(file));
          const observed = observeSerialTicket(registry, ticket);
          return { schemaId: 'atm.brokerQueueAdmission.v1', taskId: input.taskId,
            status: privateFiles.length > 0 ? 'queued-private-work' : 'queued-blocked', allowedFiles: privateFiles, queuedSharedPaths,
            waitingOn: queuedSharedPaths.map((surfacePath) => ({ surfacePath, queueHeadTaskId: ticket.taskId, position: observed.position })),
            reason: 'Native serial ticket is not write authority; explicitly revalidate its current owner, scope and base before using queued paths.' };
        }
      }
    } catch { return invalid(input.taskId, allowedFiles, 'Native broker queue authority cannot be read.'); }
  }
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

export type TeamQueueScopeDecision = {
  readonly schemaId: 'atm.teamQueueScopeDecision.v1';
  readonly verdict: 'unrestricted' | 'restricted-private-work' | 'rejected';
  readonly writePaths: readonly string[];
  readonly queuedSharedPaths: readonly string[];
  readonly reason: string;
};

/**
 * TASK-TEAM-0078 — project a team plan/start write scope through the
 * canonical shared-surface queue admission. `queued-private-work` restricts
 * the role write scope to the disjoint private paths; `queued-blocked` and
 * `invalid` reject the run. The projection never widens the input scope.
 */
export function restrictTeamWriteScopeForQueueAdmission(
  admission: BrokerQueueAdmission,
  writePaths: readonly string[]
): TeamQueueScopeDecision {
  const normalized = uniquePaths(writePaths);
  if (admission.status === 'queued-blocked' || admission.status === 'invalid') {
    return {
      schemaId: 'atm.teamQueueScopeDecision.v1',
      verdict: 'rejected',
      writePaths: [],
      queuedSharedPaths: admission.queuedSharedPaths,
      reason: admission.reason
    };
  }
  if (admission.status === 'queued-private-work') {
    const allowed = new Set(admission.allowedFiles);
    return {
      schemaId: 'atm.teamQueueScopeDecision.v1',
      verdict: 'restricted-private-work',
      writePaths: normalized.filter((entry) => allowed.has(entry)),
      queuedSharedPaths: admission.queuedSharedPaths,
      reason: admission.reason
    };
  }
  return {
    schemaId: 'atm.teamQueueScopeDecision.v1',
    verdict: 'unrestricted',
    writePaths: normalized,
    queuedSharedPaths: [],
    reason: admission.reason
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
