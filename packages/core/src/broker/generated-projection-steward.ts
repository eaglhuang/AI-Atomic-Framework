import { GOVERNANCE_BACKLOG_PROJECTION } from './global-resource-projection.ts';

export type GeneratedProjectionRequestInput = {
  readonly taskId: string;
  readonly actorId: string;
  readonly projectionKey: string;
  readonly sourceItemPaths: readonly string[];
  readonly createdAt?: string;
  readonly heartbeatAt?: string;
  readonly ttlSeconds?: number;
};

export type GeneratedProjectionRequest = {
  readonly taskId: string;
  readonly actorId: string;
  readonly projectionKey: string;
  readonly sourceItemPaths: readonly string[];
  readonly createdAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
  readonly queuePosition: number;
  readonly suggestedRetryCommand: string;
};

export type GeneratedProjectionQueue = {
  readonly projectionKey: string;
  readonly entries: readonly GeneratedProjectionRequest[];
};

export type GeneratedProjectionStewardDocument = {
  readonly schemaId: 'atm.generatedProjectionSteward.v1';
  readonly specVersion: '0.1.0';
  readonly updatedAt: string;
  readonly queues: readonly GeneratedProjectionQueue[];
};

export type GeneratedProjectionEnqueueResult = {
  readonly schemaId: 'atm.generatedProjectionStewardResult.v1';
  readonly ok: boolean;
  readonly projectionKey: string;
  readonly ownerTaskId: string;
  readonly queuePosition: number;
  readonly sourceItemPaths: readonly string[];
  readonly suggestedNextAction: string;
  readonly brokerTicket: GeneratedProjectionBrokerTicket;
  readonly queue: GeneratedProjectionStewardDocument;
};

export type GeneratedProjectionBrokerTicket = {
  readonly schemaId: 'atm.brokerTicket.v1';
  readonly ticketId: string;
  readonly position: number;
  readonly headOwner: string | null;
  readonly headHealth: 'task-active';
  readonly batchEligible: boolean;
  readonly enqueuedAt: string;
  readonly waitedMs: number;
  readonly sharedSurface: string;
  readonly scopeClass: readonly string[];
};

export type GeneratedProjectionCleanupResult = {
  readonly schemaId: 'atm.generatedProjectionStewardCleanupResult.v1';
  readonly ok: boolean;
  readonly staleReleases: readonly GeneratedProjectionStaleRelease[];
  readonly queue: GeneratedProjectionStewardDocument;
};

export type GeneratedProjectionStaleRelease = {
  readonly taskId: string;
  readonly actorId: string;
  readonly projectionKey: string;
  readonly queuePosition: number;
  readonly expiredAt: string;
  readonly suggestedRetryCommand: string;
};

export type BacklogItemShardProjectionClassification = {
  readonly schemaId: 'atm.backlogItemShardProjectionClassification.v1';
  readonly itemShardPaths: readonly string[];
  readonly generatedProjectionKeys: readonly string[];
  readonly closeBundleMustIncludeMarkdownProjection: false;
  readonly reason: string;
};

const defaultTtlSeconds = 420;

export function emptyGeneratedProjectionSteward(now = new Date().toISOString()): GeneratedProjectionStewardDocument {
  return {
    schemaId: 'atm.generatedProjectionSteward.v1',
    specVersion: '0.1.0',
    updatedAt: now,
    queues: []
  };
}

export function classifyBacklogItemShardProjectionWork(paths: readonly string[]): BacklogItemShardProjectionClassification {
  const itemShardPaths = sortedUnique(paths.map(normalizePath).filter(isGovernanceBacklogItemShard));
  return {
    schemaId: 'atm.backlogItemShardProjectionClassification.v1',
    itemShardPaths,
    generatedProjectionKeys: [],
    closeBundleMustIncludeMarkdownProjection: false,
    reason: itemShardPaths.length > 0
      ? 'Backlog item shards are append-only source records; Markdown projection rebuild is deferred to the generated-projection steward.'
      : 'No backlog item shard source records were found.'
  };
}

export function enqueueGeneratedProjectionRebuild(
  document: GeneratedProjectionStewardDocument | null | undefined,
  request: GeneratedProjectionRequestInput
): GeneratedProjectionEnqueueResult {
  const normalized = normalizeRequest(request);
  const base = normalizeDocument(document, normalized.createdAt);
  const queues = [...base.queues];
  const queueIndex = queues.findIndex((queue) => queue.projectionKey === normalized.projectionKey);
  const existingQueue = queueIndex >= 0 ? queues[queueIndex] : { projectionKey: normalized.projectionKey, entries: [] };
  const entries = [
    ...existingQueue.entries.filter((entry) => entry.taskId !== normalized.taskId),
    requestEntry(normalized, 1)
  ].sort(compareEntries);
  const nextQueue = materializeQueue({ projectionKey: normalized.projectionKey, entries });
  if (queueIndex >= 0) queues[queueIndex] = nextQueue; else queues.push(nextQueue);
  const nextDocument = materializeDocument({ ...base, updatedAt: normalized.heartbeatAt, queues });
  const materialized = nextDocument.queues.find((queue) => queue.projectionKey === normalized.projectionKey) ?? nextQueue;
  const position = materialized.entries.findIndex((entry) => entry.taskId === normalized.taskId) + 1;
  const ownerTaskId = materialized.entries[0]?.taskId ?? normalized.taskId;
  return {
    schemaId: 'atm.generatedProjectionStewardResult.v1',
    ok: true,
    projectionKey: normalized.projectionKey,
    ownerTaskId,
    queuePosition: position,
    sourceItemPaths: normalized.sourceItemPaths,
    suggestedNextAction: position === 1
      ? `Rebuild generated projection ${normalized.projectionKey} from sealed source item shards, then release the projection steward entry.`
      : `Wait for projection steward owner ${ownerTaskId}; retry ${buildRetryCommand(materialized.entries[position - 1])}.`,
    brokerTicket: buildProjectionBrokerTicket(materialized, normalized.taskId, normalized.heartbeatAt, position),
    queue: nextDocument
  };
}

export function cleanupGeneratedProjectionSteward(
  document: GeneratedProjectionStewardDocument | null | undefined,
  now = new Date().toISOString()
): GeneratedProjectionCleanupResult {
  const base = normalizeDocument(document, now);
  const staleReleases: GeneratedProjectionStaleRelease[] = [];
  const queues = base.queues.flatMap((queue) => {
    const live = queue.entries.filter((entry, index) => {
      const expired = Date.parse(entry.expiresAt) <= Date.parse(now);
      if (expired) {
        staleReleases.push({
          taskId: entry.taskId,
          actorId: entry.actorId,
          projectionKey: entry.projectionKey,
          queuePosition: index + 1,
          expiredAt: entry.expiresAt,
          suggestedRetryCommand: entry.suggestedRetryCommand
        });
      }
      return !expired;
    });
    return live.length === 0 ? [] : [materializeQueue({ ...queue, entries: live })];
  });
  return {
    schemaId: 'atm.generatedProjectionStewardCleanupResult.v1',
    ok: true,
    staleReleases,
    queue: materializeDocument({ ...base, updatedAt: now, queues })
  };
}

export function governanceBacklogProjectionKeyForPath(path: string): string | null {
  const normalized = normalizePath(path);
  if (normalized === 'docs/governance/atm-bug-and-optimization-backlog.md') {
    return GOVERNANCE_BACKLOG_PROJECTION;
  }
  return null;
}

function normalizeDocument(
  document: GeneratedProjectionStewardDocument | null | undefined,
  now: string
): GeneratedProjectionStewardDocument {
  if (!document || document.schemaId !== 'atm.generatedProjectionSteward.v1') {
    return emptyGeneratedProjectionSteward(now);
  }
  return materializeDocument({
    schemaId: 'atm.generatedProjectionSteward.v1',
    specVersion: '0.1.0',
    updatedAt: document.updatedAt || now,
    queues: Array.isArray(document.queues) ? document.queues : []
  });
}

function materializeDocument(document: GeneratedProjectionStewardDocument): GeneratedProjectionStewardDocument {
  return {
    ...document,
    queues: document.queues
      .filter((queue) => queue.entries.length > 0)
      .map(materializeQueue)
      .sort((left, right) => left.projectionKey.localeCompare(right.projectionKey))
  };
}

function materializeQueue(queue: GeneratedProjectionQueue): GeneratedProjectionQueue {
  const entries = [...queue.entries]
    .sort(compareEntries)
    .map((entry: GeneratedProjectionRequest, index: number) => ({
      ...entry,
      queuePosition: index + 1,
      suggestedRetryCommand: buildRetryCommand(entry)
    }));
  return { ...queue, entries };
}

type NormalizedRequest = Required<GeneratedProjectionRequestInput>;

function normalizeRequest(request: GeneratedProjectionRequestInput): NormalizedRequest {
  const createdAt = validIso(request.createdAt) ? request.createdAt : new Date().toISOString();
  const heartbeatAt = validIso(request.heartbeatAt) ? request.heartbeatAt : createdAt;
  const ttlSeconds = Number.isFinite(request.ttlSeconds) && (request.ttlSeconds ?? 0) > 0
    ? Math.trunc(request.ttlSeconds as number)
    : defaultTtlSeconds;
  const normalized = {
    taskId: String(request.taskId ?? '').trim(),
    actorId: String(request.actorId ?? '').trim(),
    projectionKey: String(request.projectionKey ?? '').trim(),
    sourceItemPaths: sortedUnique(request.sourceItemPaths.map(normalizePath).filter(Boolean)),
    createdAt,
    heartbeatAt,
    ttlSeconds
  };
  if (!normalized.taskId || !normalized.actorId || !normalized.projectionKey || normalized.sourceItemPaths.length === 0) {
    throw new Error('ATM_GENERATED_PROJECTION_STEWARD_REQUEST_INVALID: task, actor, projection key, and source item paths are required.');
  }
  return normalized;
}

function requestEntry(request: NormalizedRequest, queuePosition: number): GeneratedProjectionRequest {
  const expiresAt = new Date(Date.parse(request.heartbeatAt) + request.ttlSeconds * 1000).toISOString();
  return {
    ...request,
    expiresAt,
    queuePosition,
    suggestedRetryCommand: ''
  };
}

function compareEntries(left: GeneratedProjectionRequest, right: GeneratedProjectionRequest): number {
  const createdOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return left.taskId.localeCompare(right.taskId);
}

function buildRetryCommand(entry: GeneratedProjectionRequest): string {
  const items = entry.sourceItemPaths.map((itemPath) => ` --source-item ${quoteArg(itemPath)}`).join('');
  return `node atm.mjs broker projection enqueue --task ${quoteArg(entry.taskId)} --actor ${quoteArg(entry.actorId)} --projection-key ${quoteArg(entry.projectionKey)}${items} --json`;
}

function buildProjectionBrokerTicket(
  queue: GeneratedProjectionQueue,
  taskId: string,
  now: string,
  position: number
): GeneratedProjectionBrokerTicket {
  const entry = queue.entries.find((candidate) => candidate.taskId === taskId) ?? queue.entries[0];
  const enqueuedAt = entry?.createdAt ?? now;
  const waitedMs = Math.max(0, Date.parse(now) - Date.parse(enqueuedAt));
  return {
    schemaId: 'atm.brokerTicket.v1',
    ticketId: `projection:${queue.projectionKey}:${taskId}`,
    position,
    headOwner: queue.entries[0]?.taskId ?? null,
    headHealth: 'task-active',
    batchEligible: position > 1,
    enqueuedAt,
    waitedMs: Number.isFinite(waitedMs) ? waitedMs : 0,
    sharedSurface: queue.projectionKey,
    scopeClass: ['code']
  };
}

function isGovernanceBacklogItemShard(path: string): boolean {
  return path.startsWith('docs/governance/atm-bug-and-optimization-backlog.items/')
    && path.endsWith('.json');
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizePath(value: string): string {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function validIso(value: string | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function quoteArg(value: string): string {
  return JSON.stringify(value);
}
