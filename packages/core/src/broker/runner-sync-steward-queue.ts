import { RUNNER_SYNC_STEWARD_GENERATOR } from './global-resource-projection.ts';
import { buildRelatedTaskBatchEvidence, inferBrokerSurfaceFamily, type BrokerBatchEvidence } from './related-task-batching.ts';

export type RunnerSyncStewardRequestInput = {
  readonly taskId: string; readonly actorId: string; readonly sealedSourceSha: string; readonly requestedSurfaces: readonly string[];
  readonly waveId?: string | null; readonly surfaceFamily?: string | null; readonly validators?: readonly string[];
  readonly createdAt?: string; readonly heartbeatAt?: string; readonly ttlSeconds?: number;
};

export type RunnerSyncStewardRequest = {
  readonly taskId: string; readonly actorId: string; readonly sealedSourceSha: string; readonly requestedSurfaces: readonly string[];
  readonly waveId: string | null; readonly surfaceFamily: string; readonly validators: readonly string[];
  readonly createdAt: string; readonly heartbeatAt: string; readonly expiresAt: string; readonly ttlSeconds: number;
  readonly queuePosition: number; readonly suggestedNextAction: string;
};

export type RunnerSyncStewardGroup = {
  readonly stewardWorkId: string; readonly sealedSourceSha: string; readonly waveId: string | null; readonly surfaceFamily: string;
  readonly queuePosition: number; readonly status: 'queue-head' | 'waiting'; readonly queueHeadHealth?: RunnerSyncTaskHealth;
  readonly createdAt: string; readonly updatedAt: string; readonly requestedSurfaces: readonly string[];
  readonly waitingTasks: readonly string[]; readonly suggestedNextAction: string;
  readonly requests: readonly RunnerSyncStewardRequest[];
};

export type RunnerSyncStewardQueueDocument = {
  readonly schemaId: 'atm.runnerSyncStewardQueue.v1';
  readonly specVersion: '0.1.0';
  readonly stewardKey: typeof RUNNER_SYNC_STEWARD_GENERATOR;
  readonly updatedAt: string;
  readonly groups: readonly RunnerSyncStewardGroup[];
};

export type RunnerSyncStewardQueueResult = {
  readonly schemaId: 'atm.runnerSyncStewardQueueResult.v1'; readonly ok: boolean;
  readonly status: 'queue-head' | 'coalesced-waiter' | 'waiting-different-source'; readonly stewardKey: typeof RUNNER_SYNC_STEWARD_GENERATOR;
  readonly stewardWorkId: string; readonly sealedSourceSha: string; readonly queuePosition: number;
  readonly queueHeadHealth: RunnerSyncTaskHealth; readonly waitingTasks: readonly string[]; readonly requestedSurfaces: readonly string[];
  readonly suggestedNextAction: string; readonly brokerTicket: BrokerTicketEnvelope; readonly queue: RunnerSyncStewardQueueDocument;
};

export type BrokerTicketEnvelope = {
  readonly schemaId: 'atm.brokerTicket.v1'; readonly ticketId: string; readonly position: number;
  readonly headOwner: string | null; readonly headHealth: RunnerSyncTaskHealth; readonly batchEligible: boolean;
  readonly waveId?: string | null; readonly surfaceFamily?: string; readonly batch?: BrokerBatchEvidence | null;
  readonly enqueuedAt: string; readonly waitedMs: number; readonly sharedSurface: string; readonly scopeClass: readonly string[];
};

export type RunnerSyncStewardStaleRelease = {
  readonly taskId: string; readonly actorId: string; readonly sealedSourceSha: string; readonly stewardWorkId: string;
  readonly queuePosition: number; readonly expiredAt: string;
  readonly reason: 'ttl-expired' | 'orphan-task-missing' | 'orphan-task-terminal' | 'malformed-sealed-source';
  readonly safeRetryCommand: string;
};

export type RunnerSyncStewardCleanupResult = {
  readonly schemaId: 'atm.runnerSyncStewardCleanupResult.v1';
  readonly ok: boolean;
  readonly stewardKey: typeof RUNNER_SYNC_STEWARD_GENERATOR;
  readonly staleReleases: readonly RunnerSyncStewardStaleRelease[];
  readonly queue: RunnerSyncStewardQueueDocument;
};

export type RunnerSyncStewardReleaseInput = {
  readonly taskId: string;
  readonly stewardWorkId: string;
  readonly receiptRef?: string | null;
  readonly receiptDigest?: string | null;
  readonly releasedAt?: string;
};

export type RunnerSyncTaskHealth = 'task-active' | 'task-missing' | 'task-terminal';
export type TaskHealthResolver = (request: RunnerSyncStewardRequest) => RunnerSyncTaskHealth;

export type RunnerSyncStewardCleanupOptions = {
  readonly taskHealthResolver?: TaskHealthResolver;
  readonly shouldReleaseRequest?: (request: RunnerSyncStewardRequest) => boolean;
};

export type RunnerSyncStewardEnqueueOptions = {
  readonly taskHealthResolver?: (taskId: string) => RunnerSyncTaskHealth;
};

export type RunnerSyncStewardExplainOptions = {
  readonly taskHealthResolver?: TaskHealthResolver;
};

export type RunnerSyncStewardReleaseRecord = {
  readonly taskId: string;
  readonly actorId: string;
  readonly sealedSourceSha: string;
  readonly stewardWorkId: string;
  readonly queuePosition: number;
  readonly waitingTasks: readonly string[];
  readonly requestedSurfaces: readonly string[];
  readonly receiptRef: string | null;
  readonly receiptDigest: string | null;
  readonly releasedAt: string;
};

export type RunnerSyncStewardReleaseResult = {
  readonly schemaId: 'atm.runnerSyncStewardReleaseResult.v1';
  readonly ok: boolean;
  readonly stewardKey: typeof RUNNER_SYNC_STEWARD_GENERATOR;
  readonly released: RunnerSyncStewardReleaseRecord;
  readonly queue: RunnerSyncStewardQueueDocument;
  readonly next: RunnerSyncStewardQueueResult | null;
  readonly suggestedNextAction: string;
};

export type RunnerSyncStewardTaskReleaseResult = {
  readonly schemaId: 'atm.runnerSyncStewardTaskReleaseResult.v1';
  readonly ok: boolean;
  readonly releasedTaskId: string;
  readonly releasedCount: number;
  readonly queue: RunnerSyncStewardQueueDocument;
};

const defaultTtlSeconds = 420;

export function emptyRunnerSyncStewardQueue(now = new Date().toISOString()): RunnerSyncStewardQueueDocument {
  return {
    schemaId: 'atm.runnerSyncStewardQueue.v1',
    specVersion: '0.1.0',
    stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
    updatedAt: now,
    groups: []
  };
}

export function enqueueRunnerSyncStewardRequest(
  queue: RunnerSyncStewardQueueDocument | null | undefined,
  request: RunnerSyncStewardRequestInput,
  options: RunnerSyncStewardEnqueueOptions = {}
): RunnerSyncStewardQueueResult {
  const normalized = normalizeRequestInput(request);
  const taskHealth = options.taskHealthResolver?.(normalized.taskId) ?? 'task-active';
  if (taskHealth !== 'task-active') {
    throw new Error(`ATM_RUNNER_SYNC_ENQUEUE_TASK_INVALID: task ${normalized.taskId} is ${taskHealth}; runner-sync steward enqueue requires an active task.`);
  }
  const base = normalizeQueue(queue, normalized.createdAt);
  const existingIndex = base.groups.findIndex((group) => isCompatibleRunnerSyncGroup(group, normalized));
  const groups = existingIndex >= 0 ? [...base.groups] : [...base.groups, emptyGroup(normalized)];
  const targetIndex = existingIndex >= 0 ? existingIndex : groups.length - 1;
  const target = groups[targetIndex];
  const withoutCurrentTask = target.requests.filter((entry) => entry.taskId !== normalized.taskId);
  const nextRequests = [...withoutCurrentTask, requestForGroup(normalized, targetIndex + 1)]
    .sort(compareRequests);
  groups[targetIndex] = materializeGroup({
    ...target,
    updatedAt: normalized.heartbeatAt,
    requests: nextRequests
  }, targetIndex, taskHealthForRequest(options));
  const materialized = materializeQueue({ ...base, updatedAt: normalized.heartbeatAt, groups }, taskHealthForRequest(options));
  const group = materialized.groups[targetIndex];
  const status = group.queuePosition === 1
    ? 'queue-head'
    : existingIndex >= 0
      ? 'coalesced-waiter'
      : 'waiting-different-source';
  return {
    schemaId: 'atm.runnerSyncStewardQueueResult.v1',
    ok: true,
    status,
    stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
    stewardWorkId: group.stewardWorkId,
    sealedSourceSha: group.sealedSourceSha,
    queuePosition: group.queuePosition,
    queueHeadHealth: group.queueHeadHealth ?? 'task-active',
    waitingTasks: group.waitingTasks,
    requestedSurfaces: group.requestedSurfaces,
    suggestedNextAction: group.suggestedNextAction,
    brokerTicket: buildBrokerTicket(group, normalized.taskId, normalized.heartbeatAt),
    queue: materialized
  };
}

export function cleanupRunnerSyncStewardQueue(
  queue: RunnerSyncStewardQueueDocument | null | undefined,
  now = new Date().toISOString(),
  options: RunnerSyncStewardCleanupOptions = {}
): RunnerSyncStewardCleanupResult {
  const base = normalizeQueue(queue, now);
  const staleReleases: RunnerSyncStewardStaleRelease[] = [];
  const groups = base.groups.flatMap((group, groupIndex) => {
    const live = group.requests.filter((request) => {
      const expired = isExpired(request, now);
      const health = expired ? 'task-active' : resolveTaskHealth(request, options);
      const releaseReason = isFullCommitSha(request.sealedSourceSha)
        ? (expired ? 'ttl-expired' : staleReleaseReasonFromHealth(health))
        : 'malformed-sealed-source';
      if (releaseReason) {
        staleReleases.push({
          taskId: request.taskId,
          actorId: request.actorId,
          sealedSourceSha: request.sealedSourceSha,
          stewardWorkId: group.stewardWorkId,
          queuePosition: groupIndex + 1,
          expiredAt: request.expiresAt,
          reason: releaseReason,
          safeRetryCommand: buildRetryCommand(request)
        });
      }
      return !releaseReason;
    });
    return live.length === 0 ? [] : [{ ...group, requests: live, updatedAt: now }];
  });
  return {
    schemaId: 'atm.runnerSyncStewardCleanupResult.v1',
    ok: true,
    stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
    staleReleases,
    queue: materializeQueue({ ...base, updatedAt: now, groups }, options.taskHealthResolver)
  };
}

export function releaseRunnerSyncStewardQueue(
  queue: RunnerSyncStewardQueueDocument | null | undefined,
  input: RunnerSyncStewardReleaseInput
): RunnerSyncStewardReleaseResult {
  const releasedAt = validIso(input.releasedAt) ? input.releasedAt : new Date().toISOString();
  const taskId = String(input.taskId ?? '').trim();
  const stewardWorkId = String(input.stewardWorkId ?? '').trim();
  const receiptRef = normalizeOptional(input.receiptRef);
  const receiptDigest = normalizeOptional(input.receiptDigest);
  if (!taskId || !stewardWorkId) {
    throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_INVALID: task and steward work id are required.');
  }
  if (!receiptRef && !receiptDigest) {
    throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_REQUIRED: release requires --receipt-ref or --receipt-digest.');
  }

  const base = materializeQueue(normalizeQueue(queue, releasedAt));
  const groupIndex = base.groups.findIndex((group) => group.stewardWorkId === stewardWorkId);
  if (groupIndex < 0) {
    throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_NOT_FOUND: steward work ${stewardWorkId} is not queued.`);
  }
  const group = base.groups[groupIndex];
  if (group.queuePosition !== 1) {
    throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_NOT_QUEUE_HEAD: steward work ${stewardWorkId} is at queue position ${group.queuePosition}.`);
  }
  const ownerRequest = group.requests.find((request) => request.taskId === taskId);
  if (!ownerRequest) {
    throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_OWNER_MISMATCH: task ${taskId} is not waiting on ${stewardWorkId}.`);
  }

  const remainingGroups = base.groups.filter((candidate) => candidate.stewardWorkId !== stewardWorkId);
  const nextQueue = materializeQueue({ ...base, updatedAt: releasedAt, groups: remainingGroups });
  const nextGroup = nextQueue.groups[0] ?? null;
  const next = nextGroup ? groupToResult(nextQueue, nextGroup) : null;
  const released: RunnerSyncStewardReleaseRecord = {
    taskId,
    actorId: ownerRequest.actorId,
    sealedSourceSha: group.sealedSourceSha,
    stewardWorkId: group.stewardWorkId,
    queuePosition: group.queuePosition,
    waitingTasks: group.waitingTasks,
    requestedSurfaces: group.requestedSurfaces,
    receiptRef,
    receiptDigest,
    releasedAt
  };
  return {
    schemaId: 'atm.runnerSyncStewardReleaseResult.v1',
    ok: true,
    stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
    released,
    queue: nextQueue,
    next,
    suggestedNextAction: next
      ? `Runner-sync steward advanced to ${next.stewardWorkId} at queue position ${next.queuePosition}. ${next.suggestedNextAction}`
      : `Runner-sync steward queue is empty after releasing ${stewardWorkId}.`
  };
}

export function releaseRunnerSyncStewardTaskRequests(
  queue: RunnerSyncStewardQueueDocument | null | undefined,
  taskId: string,
  releasedAt = new Date().toISOString()
): RunnerSyncStewardTaskReleaseResult {
  const normalizedTaskId = String(taskId ?? '').trim();
  const base = normalizeQueue(queue, releasedAt);
  let releasedCount = 0;
  const groups = base.groups.flatMap((group) => {
    const requests = group.requests.filter((request) => {
      const keep = request.taskId !== normalizedTaskId;
      if (!keep) releasedCount += 1;
      return keep;
    });
    return requests.length === 0 ? [] : [{ ...group, requests, updatedAt: releasedAt }];
  });
  return {
    schemaId: 'atm.runnerSyncStewardTaskReleaseResult.v1',
    ok: true,
    releasedTaskId: normalizedTaskId,
    releasedCount,
    queue: materializeQueue({ ...base, updatedAt: releasedAt, groups })
  };
}

export function explainRunnerSyncStewardPosition(
  queue: RunnerSyncStewardQueueDocument | null | undefined,
  taskId: string,
  now = new Date().toISOString(),
  options: RunnerSyncStewardExplainOptions = {}
): RunnerSyncStewardQueueResult | null {
  const base = materializeQueue(normalizeQueue(queue, now), options.taskHealthResolver);
  const group = base.groups.find((candidate) => candidate.requests.some((request) => request.taskId === taskId));
  if (!group) return null;
  return groupToResult(base, group);
}

function groupToResult(queue: RunnerSyncStewardQueueDocument, group: RunnerSyncStewardGroup): RunnerSyncStewardQueueResult {
  const status = group.queuePosition === 1 ? 'queue-head' : 'coalesced-waiter';
  return {
    schemaId: 'atm.runnerSyncStewardQueueResult.v1',
    ok: true,
    status,
    stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
    stewardWorkId: group.stewardWorkId,
    sealedSourceSha: group.sealedSourceSha,
    queuePosition: group.queuePosition,
    queueHeadHealth: group.queueHeadHealth ?? 'task-active',
    waitingTasks: group.waitingTasks,
    requestedSurfaces: group.requestedSurfaces,
    suggestedNextAction: group.suggestedNextAction,
    brokerTicket: buildBrokerTicket(group, group.waitingTasks[0] ?? group.stewardWorkId, queue.updatedAt),
    queue
  };
}

function buildBrokerTicket(
  group: RunnerSyncStewardGroup,
  taskId: string,
  now: string
): BrokerTicketEnvelope {
  const request = group.requests.find((entry) => entry.taskId === taskId) ?? group.requests[0];
  const enqueuedAt = request?.createdAt ?? group.createdAt;
  const waitedMs = Math.max(0, Date.parse(now) - Date.parse(enqueuedAt));
  const batch = buildBatchEvidence(group);
  const batchEligible = batch !== null;
  return {
    schemaId: 'atm.brokerTicket.v1',
    ticketId: `${group.stewardWorkId}:${taskId}`,
    position: group.queuePosition,
    headOwner: group.waitingTasks[0] ?? null,
    headHealth: group.queueHeadHealth ?? 'task-active',
    batchEligible,
    waveId: group.waveId,
    surfaceFamily: group.surfaceFamily,
    batch,
    enqueuedAt,
    waitedMs: Number.isFinite(waitedMs) ? waitedMs : 0,
    sharedSurface: 'runner-sync',
    scopeClass: ['code']
  };
}

function buildBatchEvidence(group: RunnerSyncStewardGroup): BrokerBatchEvidence | null {
  return buildRelatedTaskBatchEvidence({
    batchId: group.stewardWorkId,
    candidate: group.requests[0]
      ? { ...group.requests[0], ticketId: `${group.stewardWorkId}:${group.requests[0].taskId}` }
      : null,
    candidates: group.requests.map((request) => ({
      ...request,
      ticketId: `${group.stewardWorkId}:${request.taskId}`
    }))
  });
}

function normalizeQueue(
  queue: RunnerSyncStewardQueueDocument | null | undefined,
  now: string
): RunnerSyncStewardQueueDocument {
  if (!queue || queue.schemaId !== 'atm.runnerSyncStewardQueue.v1') {
    return emptyRunnerSyncStewardQueue(now);
  }
  return materializeQueue({
    schemaId: 'atm.runnerSyncStewardQueue.v1',
    specVersion: '0.1.0',
    stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
    updatedAt: queue.updatedAt || now,
    groups: Array.isArray(queue.groups) ? queue.groups : []
  });
}

function materializeQueue(
  queue: RunnerSyncStewardQueueDocument,
  taskHealthResolver?: TaskHealthResolver
): RunnerSyncStewardQueueDocument {
  const groups = [...queue.groups]
    .filter((group) => group.requests.length > 0)
    .sort(compareGroups)
    .map((group, index) => materializeGroup(group, index, taskHealthResolver));
  return {
    ...queue,
    stewardKey: RUNNER_SYNC_STEWARD_GENERATOR,
    groups
  };
}

function emptyGroup(request: NormalizedRequestInput): RunnerSyncStewardGroup {
  return {
    stewardWorkId: stewardWorkIdFor(request),
    sealedSourceSha: request.sealedSourceSha,
    waveId: request.waveId,
    surfaceFamily: request.surfaceFamily,
    queuePosition: 1,
    status: 'queue-head',
    queueHeadHealth: 'task-active',
    createdAt: request.createdAt,
    updatedAt: request.heartbeatAt,
    requestedSurfaces: request.requestedSurfaces,
    waitingTasks: [],
    suggestedNextAction: '',
    requests: []
  };
}

function materializeGroup(
  group: RunnerSyncStewardGroup,
  groupIndex: number,
  taskHealthResolver?: TaskHealthResolver
): RunnerSyncStewardGroup {
  const queuePosition = groupIndex + 1;
  const requestedSurfaces = sortedUnique(group.requests.flatMap((request) => request.requestedSurfaces));
  const waitingTasks = sortedUnique(group.requests.map((request) => request.taskId));
  const headRequest = group.requests[0] ?? null;
  const status = queuePosition === 1 ? 'queue-head' : 'waiting';
  const suggestedNextAction = status === 'queue-head'
    ? `Run one runner-sync build for ${group.sealedSourceSha}, publish the steward receipt, then release ${group.stewardWorkId}.`
    : `Wait for runner-sync queue position ${queuePosition}; retry broker runner-sync status --task <task-id> --json before starting a build.`;
  return {
    ...group,
    queuePosition,
    status,
    waveId: headRequest?.waveId ?? group.waveId ?? null,
    surfaceFamily: headRequest?.surfaceFamily ?? group.surfaceFamily ?? inferBrokerSurfaceFamily(requestedSurfaces, 'runner-sync'),
    queueHeadHealth: resolveQueueHeadHealth(group.requests, taskHealthResolver),
    requestedSurfaces,
    waitingTasks,
    suggestedNextAction,
    requests: group.requests.map((request) => ({
      ...request,
      queuePosition,
      suggestedNextAction
    })).sort(compareRequests)
  };
}

function taskHealthForRequest(options: RunnerSyncStewardEnqueueOptions): TaskHealthResolver | undefined {
  return options.taskHealthResolver
    ? (request) => options.taskHealthResolver?.(request.taskId) ?? 'task-active'
    : undefined;
}

function resolveQueueHeadHealth(
  requests: readonly RunnerSyncStewardRequest[],
  taskHealthResolver?: TaskHealthResolver
): RunnerSyncTaskHealth {
  const owner = requests[0] ?? null;
  return owner ? resolveTaskHealth(owner, { taskHealthResolver }) : 'task-active';
}

type NormalizedRequestInput = {
  readonly taskId: string;
  readonly actorId: string;
  readonly sealedSourceSha: string;
  readonly requestedSurfaces: readonly string[];
  readonly waveId: string | null;
  readonly surfaceFamily: string;
  readonly validators: readonly string[];
  readonly createdAt: string;
  readonly heartbeatAt: string;
  readonly ttlSeconds: number;
};

function normalizeRequestInput(request: RunnerSyncStewardRequestInput): NormalizedRequestInput {
  const createdAt = validIso(request.createdAt) ? request.createdAt : new Date().toISOString();
  const heartbeatAt = validIso(request.heartbeatAt) ? request.heartbeatAt : createdAt;
  const ttlSeconds = Number.isFinite(request.ttlSeconds) && (request.ttlSeconds ?? 0) > 0
    ? Math.trunc(request.ttlSeconds as number)
    : defaultTtlSeconds;
  const normalized = {
    taskId: String(request.taskId ?? '').trim(),
    actorId: String(request.actorId ?? '').trim(),
    sealedSourceSha: String(request.sealedSourceSha ?? '').trim(),
    requestedSurfaces: sortedUnique(request.requestedSurfaces.map(normalizePath).filter(Boolean)),
    waveId: normalizeOptional(request.waveId),
    surfaceFamily: normalizeOptional(request.surfaceFamily) ?? inferBrokerSurfaceFamily(request.requestedSurfaces, 'runner-sync'),
    validators: sortedUnique((request.validators ?? []).map((validator) => String(validator ?? '').trim()).filter(Boolean)),
    createdAt,
    heartbeatAt,
    ttlSeconds
  };
  if (!normalized.taskId || !normalized.actorId || !normalized.sealedSourceSha || normalized.requestedSurfaces.length === 0) {
    throw new Error('ATM_RUNNER_SYNC_STEWARD_REQUEST_INVALID: task, actor, sealed source SHA, and at least one surface are required.');
  }
  return normalized;
}

function requestForGroup(request: NormalizedRequestInput, queuePosition: number): RunnerSyncStewardRequest {
  const expiresAt = new Date(Date.parse(request.heartbeatAt) + request.ttlSeconds * 1000).toISOString();
  return {
    ...request,
    expiresAt,
    queuePosition,
    suggestedNextAction: ''
  };
}

function isExpired(request: RunnerSyncStewardRequest, now: string): boolean {
  const expiresAt = Date.parse(request.expiresAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(expiresAt) && Number.isFinite(nowMs) && expiresAt <= nowMs;
}

function isFullCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

function resolveTaskHealth(
  request: RunnerSyncStewardRequest,
  options: RunnerSyncStewardCleanupOptions
): RunnerSyncTaskHealth {
  if (options.taskHealthResolver) {
    return options.taskHealthResolver(request);
  }
  return options.shouldReleaseRequest?.(request) === true ? 'task-missing' : 'task-active';
}

function staleReleaseReasonFromHealth(
  health: RunnerSyncTaskHealth
): RunnerSyncStewardStaleRelease['reason'] | null {
  if (health === 'task-missing') return 'orphan-task-missing';
  if (health === 'task-terminal') return 'orphan-task-terminal';
  return null;
}

function buildRetryCommand(request: RunnerSyncStewardRequest): string {
  const surfaces = request.requestedSurfaces.map((surface) => ` --surface ${quoteArg(surface)}`).join('');
  return `node atm.mjs broker runner-sync enqueue --task ${quoteArg(request.taskId)} --actor ${quoteArg(request.actorId)} --sealed-source-sha HEAD${surfaces} --json`;
}

function isCompatibleRunnerSyncGroup(group: RunnerSyncStewardGroup, request: NormalizedRequestInput): boolean {
  if (group.sealedSourceSha !== request.sealedSourceSha) return false;
  if (!group.waveId && !request.waveId) return true;
  return group.waveId === request.waveId && group.surfaceFamily === request.surfaceFamily;
}

function stewardWorkIdFor(request: NormalizedRequestInput): string {
  return `runner-sync-${hash32([request.sealedSourceSha, request.waveId ?? 'no-wave', request.surfaceFamily].join('|'))}`;
}

function compareGroups(left: RunnerSyncStewardGroup, right: RunnerSyncStewardGroup): number {
  const createdOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return left.sealedSourceSha.localeCompare(right.sealedSourceSha);
}

function compareRequests(left: RunnerSyncStewardRequest, right: RunnerSyncStewardRequest): number {
  const createdOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return left.taskId.localeCompare(right.taskId);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizePath(value: string): string {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function validIso(value: string | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function hash32(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function quoteArg(value: string): string {
  return JSON.stringify(value);
}
