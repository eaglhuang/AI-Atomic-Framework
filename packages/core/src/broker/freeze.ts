export const DEFAULT_FREEZE_ACK_TIMEOUT_MS = 30_000;
export const DEFAULT_WIP_SNAPSHOT_RELATIVE_DIR = '.atm/runtime/wip-snapshot';

export type FreezeState = 'pending' | 'acknowledged' | 'timed-out' | 'force-released';

export interface FreezeSignal {
  readonly taskId: string;
  readonly actorId: string;
  readonly issuedAt: string;
  readonly ackTimeoutMs: number;
  readonly freezeId: string;
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
}): FreezeSignal {
  const now = input.now ?? Date.now();
  const ackTimeoutMs = resolveFreezeAckTimeoutMs(input.ackTimeoutMs);
  return {
    freezeId: `freeze-${now}`,
    taskId: input.taskId,
    actorId: input.actorId,
    issuedAt: new Date(now).toISOString(),
    ackTimeoutMs
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
        reason: 'freeze acknowledged in time'
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
        reason: 'freeze ack timeout reached'
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
      reason: 'waiting for freeze acknowledgement'
    }
  };
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
