export const DEFAULT_FREEZE_ACK_TIMEOUT_MS = 30_000;
export const DEFAULT_WIP_SNAPSHOT_RELATIVE_DIR = '.atm/runtime/wip-snapshot';

export type FreezeState =
  | 'pending'
  | 'acknowledged'
  | 'timed-out'
  | 'force-released'
  | 'resumed'
  | 'blocked-fallback';

export interface FreezeSignal {
  readonly taskId: string;
  readonly actorId: string;
  readonly issuedAt: string;
  readonly ackTimeoutMs: number;
  readonly freezeId: string;
  readonly blockingTask?: string;
  readonly blockingRoute?: string;
  readonly conflictingResource?: string;
}

export interface FreezeAck {
  readonly freezeId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly acknowledgedAt: string;
}

export interface FreezeDecision {
  readonly freezeId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly state: FreezeState;
  readonly deadlineAt: string;
  readonly reason: string;
}

export interface FreezeResolution {
  readonly decision: FreezeDecision;
  readonly forceRelease: boolean;
  readonly requireAdmissionRecheck?: boolean;
}

export interface FreezeSnapshotDefaults {
  readonly ackTimeoutMs: number;
  readonly snapshotDir: string;
}

export function createFreezeSignal(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly now?: number;
  readonly ackTimeoutMs?: number;
  readonly blockingTask?: string;
  readonly blockingRoute?: string;
  readonly conflictingResource?: string;
}): FreezeSignal {
  const now = input.now ?? Date.now();
  const ackTimeoutMs = resolveFreezeAckTimeoutMs(input.ackTimeoutMs);
  return {
    freezeId: `freeze-${now}`,
    taskId: input.taskId,
    actorId: input.actorId,
    issuedAt: new Date(now).toISOString(),
    ackTimeoutMs,
    ...(input.blockingTask ? { blockingTask: input.blockingTask } : {}),
    ...(input.blockingRoute ? { blockingRoute: input.blockingRoute } : {}),
    ...(input.conflictingResource ? { conflictingResource: input.conflictingResource } : {})
  };
}

export function acknowledgeFreeze(signal: FreezeSignal, input: { readonly now?: number } = {}): FreezeAck {
  const now = input.now ?? Date.now();
  return {
    freezeId: signal.freezeId,
    taskId: signal.taskId,
    actorId: signal.actorId,
    acknowledgedAt: new Date(now).toISOString()
  };
}

export function resolveFreezeDecision(input: {
  readonly signal: FreezeSignal;
  readonly acknowledgedAt?: string | null;
  readonly now?: number;
}): FreezeResolution {
  const now = input.now ?? Date.now();
  const issuedAtMs = Date.parse(input.signal.issuedAt);
  const deadlineAtMs = issuedAtMs + input.signal.ackTimeoutMs;
  const acknowledgedAtMs = input.acknowledgedAt ? Date.parse(input.acknowledgedAt) : Number.NaN;

  if (Number.isFinite(acknowledgedAtMs) && acknowledgedAtMs <= deadlineAtMs) {
    return {
      forceRelease: false,
      decision: {
        freezeId: input.signal.freezeId,
        taskId: input.signal.taskId,
        actorId: input.signal.actorId,
        state: 'acknowledged',
        deadlineAt: new Date(deadlineAtMs).toISOString(),
        reason: appendDiagnostic('freeze acknowledged in time', input.signal)
      }
    };
  }

  if (now > deadlineAtMs) {
    return {
      forceRelease: true,
      decision: {
        freezeId: input.signal.freezeId,
        taskId: input.signal.taskId,
        actorId: input.signal.actorId,
        state: 'timed-out',
        deadlineAt: new Date(deadlineAtMs).toISOString(),
        reason: appendDiagnostic('freeze ack timeout reached', input.signal)
      }
    };
  }

  return {
    forceRelease: false,
    decision: {
      freezeId: input.signal.freezeId,
      taskId: input.signal.taskId,
      actorId: input.signal.actorId,
      state: 'pending',
      deadlineAt: new Date(deadlineAtMs).toISOString(),
      reason: appendDiagnostic('waiting for freeze acknowledgement', input.signal)
    }
  };
}

export function resumeFreeze(
  signal: FreezeSignal,
  input: { readonly now?: number; readonly admissionRechecked?: boolean } = {}
): FreezeResolution {
  const now = input.now ?? Date.now();
  const issuedAtMs = Date.parse(signal.issuedAt);
  const deadlineAtMs = issuedAtMs + signal.ackTimeoutMs;
  return {
    forceRelease: false,
    requireAdmissionRecheck: input.admissionRechecked ? false : true,
    decision: {
      freezeId: signal.freezeId,
      taskId: signal.taskId,
      actorId: signal.actorId,
      state: 'resumed',
      deadlineAt: new Date(deadlineAtMs).toISOString(),
      reason: appendDiagnostic(
        input.admissionRechecked
          ? `freeze resumed after broker admission recheck at ${new Date(now).toISOString()}`
          : `freeze resume requested at ${new Date(now).toISOString()}; broker admission must be re-checked before write`,
        signal
      )
    }
  };
}

export function markBlockedFallback(
  signal: FreezeSignal,
  input: {
    readonly now?: number;
    readonly repeatedConflict?: {
      readonly blockingTask?: string;
      readonly blockingRoute?: string;
      readonly conflictingResource?: string;
    };
  } = {}
): FreezeResolution {
  const now = input.now ?? Date.now();
  const issuedAtMs = Date.parse(signal.issuedAt);
  const deadlineAtMs = issuedAtMs + signal.ackTimeoutMs;
  const repeat = input.repeatedConflict ?? {};
  const conflictDescriptor =
    [repeat.blockingTask, repeat.blockingRoute, repeat.conflictingResource]
      .filter((part): part is string => Boolean(part))
      .join('/') || 'prior conflict';
  return {
    forceRelease: false,
    decision: {
      freezeId: signal.freezeId,
      taskId: signal.taskId,
      actorId: signal.actorId,
      state: 'blocked-fallback',
      deadlineAt: new Date(deadlineAtMs).toISOString(),
      reason: appendDiagnostic(
        `blocked fallback at ${new Date(now).toISOString()}: repeated conflict (${conflictDescriptor}); protocol does not delete worktree changes`,
        signal
      )
    }
  };
}

function appendDiagnostic(base: string, signal: FreezeSignal): string {
  const parts: string[] = [];
  if (signal.blockingTask) parts.push(`blockingTask=${signal.blockingTask}`);
  if (signal.blockingRoute) parts.push(`blockingRoute=${signal.blockingRoute}`);
  if (signal.conflictingResource) parts.push(`conflictingResource=${signal.conflictingResource}`);
  return parts.length === 0 ? base : `${base} [${parts.join(' ')}]`;
}

export function resolveFreezeSnapshotDefaults(): FreezeSnapshotDefaults {
  return {
    ackTimeoutMs: DEFAULT_FREEZE_ACK_TIMEOUT_MS,
    snapshotDir: DEFAULT_WIP_SNAPSHOT_RELATIVE_DIR
  };
}

function resolveFreezeAckTimeoutMs(input: number | undefined): number {
  return Math.max(1, Math.floor(input ?? DEFAULT_FREEZE_ACK_TIMEOUT_MS));
}
