export const DEFAULT_FREEZE_ACK_TIMEOUT_MS = 30_000;
export const DEFAULT_WIP_SNAPSHOT_RELATIVE_DIR = '.atm/runtime/wip-snapshot';
export function createFreezeSignal(input) {
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
export function acknowledgeFreeze(signal, input = {}) {
    const now = input.now ?? Date.now();
    return {
        freezeId: signal.freezeId,
        taskId: signal.taskId,
        actorId: signal.actorId,
        acknowledgedAt: new Date(now).toISOString()
    };
}
export function resolveFreezeDecision(input) {
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
export function resumeFreeze(signal, input = {}) {
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
            reason: appendDiagnostic(input.admissionRechecked
                ? `freeze resumed after broker admission recheck at ${new Date(now).toISOString()}`
                : `freeze resume requested at ${new Date(now).toISOString()}; broker admission must be re-checked before write`, signal)
        }
    };
}
export function markBlockedFallback(signal, input = {}) {
    const now = input.now ?? Date.now();
    const issuedAtMs = Date.parse(signal.issuedAt);
    const deadlineAtMs = issuedAtMs + signal.ackTimeoutMs;
    const repeat = input.repeatedConflict ?? {};
    const conflictDescriptor = [repeat.blockingTask, repeat.blockingRoute, repeat.conflictingResource]
        .filter((part) => Boolean(part))
        .join('/') || 'prior conflict';
    return {
        forceRelease: false,
        decision: {
            freezeId: signal.freezeId,
            taskId: signal.taskId,
            actorId: signal.actorId,
            state: 'blocked-fallback',
            deadlineAt: new Date(deadlineAtMs).toISOString(),
            reason: appendDiagnostic(`blocked fallback at ${new Date(now).toISOString()}: repeated conflict (${conflictDescriptor}); protocol does not delete worktree changes`, signal)
        }
    };
}
function appendDiagnostic(base, signal) {
    const parts = [];
    if (signal.blockingTask)
        parts.push(`blockingTask=${signal.blockingTask}`);
    if (signal.blockingRoute)
        parts.push(`blockingRoute=${signal.blockingRoute}`);
    if (signal.conflictingResource)
        parts.push(`conflictingResource=${signal.conflictingResource}`);
    return parts.length === 0 ? base : `${base} [${parts.join(' ')}]`;
}
export function resolveFreezeSnapshotDefaults() {
    return {
        ackTimeoutMs: DEFAULT_FREEZE_ACK_TIMEOUT_MS,
        snapshotDir: DEFAULT_WIP_SNAPSHOT_RELATIVE_DIR
    };
}
function resolveFreezeAckTimeoutMs(input) {
    return Math.max(1, Math.floor(input ?? DEFAULT_FREEZE_ACK_TIMEOUT_MS));
}
