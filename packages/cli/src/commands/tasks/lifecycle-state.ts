export type TaskClaimIntent = 'write' | 'closeout-only';

export interface TaskLifecycleAdmissionOk {
  readonly ok: true;
  readonly reason: string;
}

export interface TaskLifecycleAdmissionBlocked {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

export type TaskLifecycleAdmission = TaskLifecycleAdmissionOk | TaskLifecycleAdmissionBlocked;

export function normalizeTaskLifecycleStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}

export function evaluateTaskPromotionAdmission(input: {
  readonly taskId: string;
  readonly status: unknown;
}): TaskLifecycleAdmission {
  const status = normalizeTaskLifecycleStatus(input.status);
  if (status === 'reserved') {
    return { ok: true, reason: 'reserved-to-ready' };
  }
  return {
    ok: false,
    code: 'ATM_TASKS_PROMOTE_INVALID_STATE',
    message: `Task ${input.taskId} must be in reserved state before promote.`,
    details: { taskId: input.taskId, status: input.status ?? null }
  };
}

export function evaluateTaskResetAdmission(input: {
  readonly taskId: string;
  readonly fromStatus: unknown;
  readonly toStatus: string;
}): TaskLifecycleAdmission {
  const fromStatus = normalizeTaskLifecycleStatus(input.fromStatus);
  if (input.toStatus !== 'open') {
    return {
      ok: false,
      code: 'ATM_CLI_USAGE',
      message: 'tasks reset currently supports only --to open.',
      details: { taskId: input.taskId, toStatus: input.toStatus }
    };
  }
  if (fromStatus === 'done') {
    return {
      ok: false,
      code: 'ATM_TASK_RESET_DONE_REQUIRES_REOPEN',
      message: `Task ${input.taskId} is done and cannot be reset to open without a reopen flow.`,
      details: { taskId: input.taskId, status: fromStatus }
    };
  }
  const allowedFrom = ['reserved', 'ready', 'running', 'open'];
  if (allowedFrom.includes(fromStatus)) {
    return { ok: true, reason: `${fromStatus}-to-open` };
  }
  return {
    ok: false,
    code: 'ATM_TASK_RESET_INVALID_STATE',
    message: `Task ${input.taskId} cannot reset from ${fromStatus} to open.`,
    details: { taskId: input.taskId, status: fromStatus, allowedFrom }
  };
}

export function evaluateTaskClaimAdmission(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly status: unknown;
  readonly claimIntent: TaskClaimIntent;
}): TaskLifecycleAdmission {
  const status = normalizeTaskLifecycleStatus(input.status);
  if (status === 'ready') {
    return { ok: true, reason: 'ready-claim' };
  }
  if (status === 'review' && input.claimIntent === 'closeout-only') {
    return { ok: true, reason: 'review-closeout-only-reclaim' };
  }
  if (status === 'review') {
    return {
      ok: false,
      code: 'ATM_TASK_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED',
      message: `Task ${input.taskId} is in review and can only be reclaimed through closeout-only claim intent.`,
      details: {
        taskId: input.taskId,
        status,
        claimIntent: input.claimIntent,
        requiredCommand: `node atm.mjs next --claim --actor ${input.actorId} --prompt ${input.taskId} --claim-intent closeout-only --json`,
        directCommand: `node atm.mjs tasks claim --task ${input.taskId} --actor ${input.actorId} --claim-intent closeout-only --files <scoped-files> --json`,
        remediation: 'Use closeout-only only when the scoped deliverable already landed and the remaining work is governed closeback. If the deliverable is still missing, leave the task in review.'
      }
    };
  }
  return {
    ok: false,
    code: 'ATM_TASK_CLAIM_NOT_READY',
    message: `Task ${input.taskId} must be ready before it can be claimed.`,
    details: {
      taskId: input.taskId,
      status
    }
  };
}

export function evaluateTaskDoneCloseAdmission(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly status: unknown;
  readonly claimState: string | null;
  readonly claimActorId: string | null;
  readonly hasActiveSession: boolean;
  readonly allowHistoricalCloseback?: boolean;
}): TaskLifecycleAdmission {
  const status = normalizeTaskLifecycleStatus(input.status);
  if (input.allowHistoricalCloseback) {
    const allowedHistoricalStatuses = new Set([
      'planned',
      'open',
      'in_progress',
      'reserved',
      'ready',
      'running',
      'review',
      'blocked'
    ]);
    if (allowedHistoricalStatuses.has(status)) {
      if (input.claimState === 'active' && input.claimActorId === input.actorId) {
        return { ok: true, reason: `${status}-to-done-historical-closeback` };
      }
      return { ok: true, reason: `${status}-to-done-verified-historical-closeback` };
    }
  }
  if (status === 'planned') {
    return {
      ok: false,
      code: 'ATM_TASK_CLOSE_INVALID_LIFECYCLE',
      message: `Task ${input.taskId} status is ${status}. Cannot close a task directly from ${status} to done.`,
      details: {
        taskId: input.taskId,
        previousStatus: status,
        status: 'done'
      }
    };
  }
  if (input.claimState !== 'active' || input.claimActorId !== input.actorId) {
    return {
      ok: false,
      code: 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED',
      message: `Task ${input.taskId} cannot be closed as done without an active claim owned by ${input.actorId}.`,
      details: {
        taskId: input.taskId,
        actorId: input.actorId,
        requiredCommand: `node atm.mjs next --claim --actor ${input.actorId} --prompt "${input.taskId}" --json`
      }
    };
  }
  if (!input.hasActiveSession) {
    return {
      ok: false,
      code: 'ATM_TASK_CLOSE_SESSION_CONTEXT_REQUIRED',
      message: `Task ${input.taskId} cannot be closed as done without an active work session.`,
      details: {
        taskId: input.taskId,
        actorId: input.actorId
      }
    };
  }
  return { ok: true, reason: `${status}-to-done` };
}
