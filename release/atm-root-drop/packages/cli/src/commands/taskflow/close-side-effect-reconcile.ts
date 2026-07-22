export type CloseSideEffectName = 'live-ledger' | 'target-commit' | 'planning-closeback';

export interface CloseSideEffectReceipt {
  readonly name: CloseSideEffectName;
  readonly status: 'pending' | 'completed' | 'failed' | 'reconciled';
  readonly idempotencyKey: string;
  readonly beforeDigest: string | null;
  readonly afterDigest: string | null;
  readonly commitSha?: string | null;
  readonly ref?: string | null;
}

export interface CloseSideEffectReconcileReport {
  readonly schemaId: 'atm.closeSideEffectReconcile.v1';
  readonly taskId: string;
  readonly ok: boolean;
  readonly disposition: 'fail-closed' | 'completed' | 'reconciled';
  readonly code: 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT' | null;
  readonly summary: string;
  readonly replayAllowed: boolean;
  readonly completedSideEffects: readonly CloseSideEffectReceipt[];
  readonly recoveryCommand: string;
}

const TERMINAL_STATUSES = new Set(['completed', 'reconciled']);

export function buildCloseSideEffectIdempotencyKey(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly sideEffect: CloseSideEffectName;
  readonly beforeDigest: string | null;
}): string {
  return [
    'atm-close-side-effect',
    input.taskId.trim().toUpperCase(),
    input.actorId.trim() || 'unknown-actor',
    input.sideEffect,
    input.beforeDigest ?? 'no-before-digest'
  ].join(':');
}

export function reconcileCloseSideEffects(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly planningSourceIdentityDrift: boolean;
  readonly sideEffects: readonly CloseSideEffectReceipt[];
}): CloseSideEffectReconcileReport {
  const completedSideEffects = input.sideEffects.filter((entry) => TERMINAL_STATUSES.has(entry.status));
  const recoveryCommand = `node atm.mjs tasks status --task ${input.taskId} --json`;
  if (!input.planningSourceIdentityDrift) {
    return {
      schemaId: 'atm.closeSideEffectReconcile.v1',
      taskId: input.taskId,
      ok: true,
      disposition: completedSideEffects.length === input.sideEffects.length ? 'completed' : 'reconciled',
      code: null,
      summary: 'Close side effects are admissible; no planning source identity drift was detected.',
      replayAllowed: false,
      completedSideEffects,
      recoveryCommand
    };
  }
  if (completedSideEffects.length === 0) {
    return {
      schemaId: 'atm.closeSideEffectReconcile.v1',
      taskId: input.taskId,
      ok: false,
      disposition: 'fail-closed',
      code: 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT',
      summary: 'Planning source identity drift was detected before any declared close side effect completed.',
      replayAllowed: false,
      completedSideEffects,
      recoveryCommand
    };
  }
  return {
    schemaId: 'atm.closeSideEffectReconcile.v1',
    taskId: input.taskId,
    ok: true,
    disposition: 'reconciled',
    code: 'ATM_PLANNING_SOURCE_IDENTITY_DRIFT',
    summary: 'Planning source identity drift occurred after terminal close side effects; ATM reports a reconciled receipt instead of replaying commit, close, push, or planning closeback.',
    replayAllowed: false,
    completedSideEffects,
    recoveryCommand
  };
}
