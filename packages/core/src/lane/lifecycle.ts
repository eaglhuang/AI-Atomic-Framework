export interface LaneLifecycleOwner {
  readonly actorId?: string | null;
  readonly laneSessionId?: string | null;
}

export interface LaneLifecycleMismatch {
  readonly sameOwner: boolean;
  readonly mode: 'lane-id' | 'actor-fallback';
  readonly requiredCommand: string | null;
}

export function normalizeLaneScopePath(value: string): string {
  return value.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').replace(/\\/g, '/');
}

export function normalizeLaneScopePaths(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map(normalizeLaneScopePath).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

export function buildLaneLifecycleReconcileCommand(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly reason: string;
}): string {
  return [
    'node',
    'atm.mjs',
    'tasks',
    'repair-claim',
    '--task',
    quoteCliValue(input.taskId),
    '--actor',
    quoteCliValue(input.actorId),
    '--write',
    '--reason',
    quoteCliValue(input.reason),
    '--json'
  ].join(' ');
}

export function evaluateLaneLifecycleMismatch(input: {
  readonly current: LaneLifecycleOwner;
  readonly requested: LaneLifecycleOwner;
  readonly taskId: string;
  readonly actorId: string;
}): LaneLifecycleMismatch {
  const currentLane = normalizeOptional(input.current.laneSessionId);
  const requestedLane = normalizeOptional(input.requested.laneSessionId);
  if (currentLane && requestedLane) {
    const sameOwner = currentLane === requestedLane;
    return {
      sameOwner,
      mode: 'lane-id',
      requiredCommand: sameOwner
        ? null
        : buildLaneLifecycleReconcileCommand({
          taskId: input.taskId,
          actorId: input.actorId,
          reason: `reconcile lane mismatch ${currentLane} -> ${requestedLane}`
        })
    };
  }
  const currentActor = normalizeOptional(input.current.actorId);
  const requestedActor = normalizeOptional(input.requested.actorId);
  const sameOwner = Boolean(currentActor && requestedActor && currentActor === requestedActor);
  return {
    sameOwner,
    mode: 'actor-fallback',
    requiredCommand: sameOwner
      ? null
      : buildLaneLifecycleReconcileCommand({
        taskId: input.taskId,
        actorId: input.actorId,
        reason: `reconcile actor mismatch ${currentActor ?? 'unknown'} -> ${requestedActor ?? 'unknown'}`
      })
  };
}

function normalizeOptional(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function quoteCliValue(value: string): string {
  return /^[A-Za-z0-9._:/-]+$/.test(value)
    ? value
    : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
