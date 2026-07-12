export type SharedSurfaceQueueEntry = {
  readonly taskId: string;
  readonly actorId: string;
  readonly surfacePath: string;
  readonly leaseEpoch: number;
  readonly baseHash: string;
  readonly reason: string;
  readonly releaseCondition: string;
  readonly queuedAt: string;
};

export type SharedSurfaceQueue = {
  readonly schemaId: 'atm.brokerSharedSurfaceQueue.v1';
  readonly surfacePath: string;
  readonly entries: readonly SharedSurfaceQueueEntry[];
};

export type SharedSurfaceQueueResult = {
  readonly ok: boolean;
  readonly queue: SharedSurfaceQueue;
  readonly position: number | null;
  readonly code: 'queued' | 'already-queued' | 'invalid-entry' | 'base-hash-mismatch';
  readonly reason: string;
};

export type SharedSurfaceAcquisitionPlan = {
  readonly taskId: string;
  readonly orderedSurfacePaths: readonly string[];
  readonly readyToMutateSharedPaths: boolean;
  readonly waitingOn: readonly { surfacePath: string; queueHeadTaskId: string }[];
};

export function enqueueSharedSurface(input: {
  readonly queue?: SharedSurfaceQueue | null;
  readonly entry: SharedSurfaceQueueEntry;
}): SharedSurfaceQueueResult {
  const entry = normalizeEntry(input.entry);
  const existing = input.queue?.entries ?? [];
  const surfacePath = input.queue?.surfacePath ?? entry?.surfacePath ?? '';
  const queue: SharedSurfaceQueue = {
    schemaId: 'atm.brokerSharedSurfaceQueue.v1',
    surfacePath,
    entries: existing
  };
  if (!entry || surfacePath !== entry.surfacePath) {
    return { ok: false, queue, position: null, code: 'invalid-entry', reason: 'Shared queue entries require one normalized surface path, task, actor, positive epoch, hash, and release condition.' };
  }
  if (existing.some((candidate) => candidate.taskId === entry.taskId)) {
    return { ok: true, queue, position: existing.findIndex((candidate) => candidate.taskId === entry.taskId) + 1, code: 'already-queued', reason: 'Task already has a deterministic shared-surface queue position.' };
  }
  if (existing.some((candidate) => candidate.baseHash !== entry.baseHash)) {
    return { ok: false, queue, position: null, code: 'base-hash-mismatch', reason: 'Shared-surface proposals use different base hashes and require re-arbitration before queueing.' };
  }
  // Every surface uses the same stable request ordering. A task may enter its
  // shared-write lane only after it is head for every requested surface, so it
  // never holds one surface while waiting for another.
  const entries = [...existing, entry].sort(compareQueueEntries);
  return {
    ok: true,
    queue: { ...queue, entries },
    position: entries.length,
    code: 'queued',
    reason: 'Private paths may proceed, but this shared surface remains queued until the prior entry satisfies its release condition.'
  };
}

export function planSharedSurfaceAcquisition(queues: readonly SharedSurfaceQueue[], taskId: string): SharedSurfaceAcquisitionPlan {
  const relevant = queues
    .filter((queue) => queue.entries.some((entry) => entry.taskId === taskId))
    .sort((left, right) => left.surfacePath.localeCompare(right.surfacePath));
  const waitingOn = relevant
    .filter((queue) => queue.entries[0]?.taskId !== taskId)
    .map((queue) => ({ surfacePath: queue.surfacePath, queueHeadTaskId: queue.entries[0]?.taskId ?? 'unknown' }));
  return {
    taskId,
    orderedSurfacePaths: relevant.map((queue) => queue.surfacePath),
    readyToMutateSharedPaths: relevant.length > 0 && waitingOn.length === 0,
    waitingOn
  };
}

export function releaseSharedSurfaceHead(input: { readonly queue: SharedSurfaceQueue; readonly taskId: string }): SharedSurfaceQueue {
  if (input.queue.entries[0]?.taskId !== input.taskId) {
    throw new Error('ATM_BROKER_SHARED_QUEUE_RELEASE_FORBIDDEN: only the queue head may release a shared surface.');
  }
  return { ...input.queue, entries: input.queue.entries.slice(1) };
}

function normalizeEntry(value: SharedSurfaceQueueEntry): SharedSurfaceQueueEntry | null {
  const taskId = String(value?.taskId ?? '').trim();
  const actorId = String(value?.actorId ?? '').trim();
  const surfacePath = String(value?.surfacePath ?? '').trim().replace(/\\/g, '/');
  const baseHash = String(value?.baseHash ?? '').trim();
  const reason = String(value?.reason ?? '').trim();
  const releaseCondition = String(value?.releaseCondition ?? '').trim();
  if (!taskId || !actorId || !surfacePath || !baseHash || !reason || !releaseCondition || !Number.isInteger(value?.leaseEpoch) || value.leaseEpoch < 1) return null;
  return { ...value, taskId, actorId, surfacePath, baseHash, reason, releaseCondition };
}

function compareQueueEntries(left: SharedSurfaceQueueEntry, right: SharedSurfaceQueueEntry): number {
  const epochOrder = left.leaseEpoch - right.leaseEpoch;
  if (epochOrder !== 0) return epochOrder;
  const queuedAtOrder = left.queuedAt.localeCompare(right.queuedAt);
  if (queuedAtOrder !== 0) return queuedAtOrder;
  return left.taskId.localeCompare(right.taskId);
}
