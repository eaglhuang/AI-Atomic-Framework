import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { quoteCliValue, relativePathFrom } from '../shared.ts';

export interface TaskflowBranchCommitQueueGate {
  readonly schemaId: 'atm.taskflowBranchCommitQueueGate.v1';
  readonly status: 'clear' | 'busy';
  readonly branchRef: string | null;
  readonly branchName: string;
  readonly lockPath: string | null;
  readonly actorId: string | null;
  readonly summary: string;
  readonly requiredCommand: string | null;
  readonly brokerTicket?: TaskflowBrokerTicket | null;
}

export interface TaskflowBrokerTicket {
  readonly schemaId: 'atm.brokerTicket.v1';
  readonly ticketId: string;
  readonly position: number;
  readonly headOwner: string | null;
  readonly headHealth: 'task-active';
  readonly batchEligible: boolean;
  readonly waveId?: string | null;
  readonly surfaceFamily?: string;
  readonly batch?: TaskflowBrokerBatchEvidence | null;
  readonly enqueuedAt: string;
  readonly waitedMs: number;
  readonly sharedSurface: string;
  readonly scopeClass: readonly string[];
}

export interface TaskflowBrokerBatchEvidence {
  readonly schemaId: 'atm.brokerBatchEvidence.v1';
  readonly batchId: string;
  readonly waveId: string;
  readonly taskIds: readonly string[];
  readonly ticketIds: readonly string[];
  readonly sharedSurfaceFamily: string;
  readonly validators: readonly string[];
  readonly batchRate: number;
  readonly buildsPerWave: number;
}

function readTaskflowHeadBranchRef(cwd: string): string | null {
  try {
    const value = execFileSync('git', ['symbolic-ref', '-q', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function taskflowBranchCommitQueueLockPath(cwd: string, branchRef: string | null): string {
  const rawName = branchRef && branchRef.trim().length > 0 ? branchRef : 'detached-head';
  const safeName = rawName.replace(/[^A-Za-z0-9._-]+/g, '-');
  return path.join(cwd, '.atm', 'runtime', 'locks', `git-commit-queue-${safeName}.lock`);
}

export function evaluateTaskflowBranchCommitQueueGate(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  waveId?: string | null;
  surfaceFamily?: string | null;
  validators?: readonly string[];
}): TaskflowBranchCommitQueueGate {
  const branchRef = readTaskflowHeadBranchRef(input.cwd);
  const branchName = branchRef ? branchRef.replace(/^refs\/heads\//, '') : 'detached-head';
  const lockPath = taskflowBranchCommitQueueLockPath(input.cwd, branchRef);
  const recordPath = path.join(lockPath, 'record.json');
  if (!existsSync(recordPath)) {
    return {
      schemaId: 'atm.taskflowBranchCommitQueueGate.v1',
      status: 'clear',
      branchRef,
      branchName,
      lockPath: null,
      actorId: null,
      summary: 'No active branch commit queue lock blocks this close.',
      requiredCommand: null
    };
  }
  try {
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as Record<string, unknown>;
    const queueActorId = typeof record.actorId === 'string' ? record.actorId : null;
    if (queueActorId && queueActorId === input.actorId) {
      return {
        schemaId: 'atm.taskflowBranchCommitQueueGate.v1',
        status: 'clear',
        branchRef,
        branchName,
        lockPath: relativePathFrom(input.cwd, lockPath),
        actorId: queueActorId,
        summary: 'Branch commit queue lock is already owned by this actor.',
        requiredCommand: null
      };
    }
    return {
      schemaId: 'atm.taskflowBranchCommitQueueGate.v1',
      status: 'busy',
      branchRef,
      branchName,
      lockPath: relativePathFrom(input.cwd, lockPath),
      actorId: queueActorId,
      summary: queueActorId
        ? `Another governed writer (${queueActorId}) is finalizing branch ${branchName}. Wait for the branch commit queue to clear before taskflow close --write.`
        : `Another governed writer is finalizing branch ${branchName}. Wait for the branch commit queue to clear before taskflow close --write.`,
      requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId)} --write --json`,
      brokerTicket: buildBranchCommitBrokerTicket({ taskId: input.taskId, branchName, queueActorId, record, waveId: input.waveId, surfaceFamily: input.surfaceFamily, validators: input.validators })
    };
  } catch {
    return {
      schemaId: 'atm.taskflowBranchCommitQueueGate.v1',
      status: 'busy',
      branchRef,
      branchName,
      lockPath: relativePathFrom(input.cwd, lockPath),
      actorId: null,
      summary: `Branch commit queue lock for ${branchName} exists but could not be parsed. Clear or wait for the active governed writer before taskflow close --write.`,
      requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId)} --write --json`,
      brokerTicket: buildBranchCommitBrokerTicket({ taskId: input.taskId, branchName, queueActorId: null, record: null, waveId: input.waveId, surfaceFamily: input.surfaceFamily, validators: input.validators })
    };
  }
}

function buildBranchCommitBrokerTicket(input: {
  readonly taskId: string;
  readonly branchName: string;
  readonly queueActorId: string | null;
  readonly record: Record<string, unknown> | null;
  readonly waveId?: string | null;
  readonly surfaceFamily?: string | null;
  readonly validators?: readonly string[];
}): TaskflowBrokerTicket {
  const enqueuedAt = typeof input.record?.acquiredAt === 'string' ? input.record.acquiredAt : new Date().toISOString();
  const waitedMs = Math.max(0, Date.now() - Date.parse(enqueuedAt));
  const waveId = normalizeOptional(input.waveId);
  const surfaceFamily = normalizeOptional(input.surfaceFamily) ?? `branch-commit:${input.branchName}`;
  const headTaskId = typeof input.record?.taskId === 'string' ? input.record.taskId : null;
  const headWaveId = normalizeOptional(input.record?.waveId as string | null | undefined);
  const headSurfaceFamily = normalizeOptional(input.record?.surfaceFamily as string | null | undefined) ?? surfaceFamily;
  const batch = waveId && headTaskId && headWaveId === waveId && headSurfaceFamily === surfaceFamily
    ? {
      schemaId: 'atm.brokerBatchEvidence.v1' as const,
      batchId: `${waveId}:${surfaceFamily}:${input.branchName}`,
      waveId,
      taskIds: [headTaskId, input.taskId].sort((left, right) => left.localeCompare(right)),
      ticketIds: [headTaskId, input.taskId].sort((left, right) => left.localeCompare(right)).map((taskId) => `branch-commit:${input.branchName}:${taskId}`),
      sharedSurfaceFamily: surfaceFamily,
      validators: sortedUnique([...(Array.isArray(input.record?.validators) ? input.record?.validators as string[] : []), ...(input.validators ?? [])]),
      batchRate: 1,
      buildsPerWave: 1
    }
    : null;
  return {
    schemaId: 'atm.brokerTicket.v1',
    ticketId: `branch-commit:${input.branchName}:${input.taskId}`,
    position: 2,
    headOwner: input.queueActorId,
    headHealth: 'task-active',
    batchEligible: batch !== null,
    waveId,
    surfaceFamily,
    batch,
    enqueuedAt,
    waitedMs: Number.isFinite(waitedMs) ? waitedMs : 0,
    sharedSurface: `branch-commit:${input.branchName}`,
    scopeClass: ['code']
  };
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
