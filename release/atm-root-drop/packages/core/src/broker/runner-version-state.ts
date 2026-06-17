// TASK-MAO-0017: runner version stream state machine. Models the lifecycle of a
// runner version stream from in-dev moving HEAD through release candidates to a
// frozen published version. Used by the runner submit pipeline (TASK-MAO-0016)
// to know whether a target ref accepts new patches, and by the closure-runner
// binding (TASK-MAO-0018) to fix the published version into a closure packet.
import type { MigrationRecord } from './types.ts';

export type RunnerVersionState =
  | 'in-dev'        // moving control ref, accepts patches
  | 'rc-stabilizing' // accepts only bug-fix patches
  | 'rc-frozen'     // no patches; only build verification
  | 'published'     // immutable; closure packets may bind to this
  | 'retired';      // historical reference only

export type RunnerVersionTransition =
  | 'cut-rc'
  | 'freeze-rc'
  | 'publish'
  | 'rollback-rc'
  | 'retire';

export interface RunnerVersionStreamRecord {
  readonly schemaId: 'atm.runnerVersionStream.v1';
  readonly specVersion: '0.1.0';
  readonly migration: MigrationRecord;
  readonly streamId: string;
  readonly state: RunnerVersionState;
  readonly lease: {
    readonly heldBy: string | null;
    readonly heldUntil: string | null;
  };
  readonly history: readonly {
    readonly at: string;
    readonly transition: RunnerVersionTransition;
    readonly fromState: RunnerVersionState;
    readonly toState: RunnerVersionState;
    readonly actorId: string;
  }[];
}

export function createRunnerVersionStream(streamId: string): RunnerVersionStreamRecord {
  return {
    schemaId: 'atm.runnerVersionStream.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'Runner version stream baseline.' },
    streamId,
    state: 'in-dev',
    lease: { heldBy: null, heldUntil: null },
    history: []
  };
}

const ALLOWED: Record<RunnerVersionState, readonly RunnerVersionTransition[]> = {
  'in-dev': ['cut-rc'],
  'rc-stabilizing': ['freeze-rc', 'rollback-rc'],
  'rc-frozen': ['publish', 'rollback-rc'],
  published: ['retire'],
  retired: []
};

const RESULT: Record<RunnerVersionTransition, RunnerVersionState> = {
  'cut-rc': 'rc-stabilizing',
  'freeze-rc': 'rc-frozen',
  publish: 'published',
  'rollback-rc': 'in-dev',
  retire: 'retired'
};

export interface RunnerVersionTransitionResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly record: RunnerVersionStreamRecord;
}

export function transitionRunnerVersion(
  record: RunnerVersionStreamRecord,
  transition: RunnerVersionTransition,
  actorId: string,
  at: string = new Date().toISOString()
): RunnerVersionTransitionResult {
  if (!ALLOWED[record.state].includes(transition)) {
    return {
      ok: false,
      reason: `transition ${transition} is not allowed from state ${record.state}`,
      record
    };
  }
  if (!actorId.trim()) {
    return { ok: false, reason: 'actorId is required for a state transition', record };
  }
  const fromState = record.state;
  const toState = RESULT[transition];
  return {
    ok: true,
    reason: `state ${fromState} -> ${toState}`,
    record: {
      ...record,
      state: toState,
      history: [...record.history, { at, transition, fromState, toState, actorId }]
    }
  };
}

export function acquireRunnerVersionLease(
  record: RunnerVersionStreamRecord,
  actorId: string,
  ttlSeconds: number,
  now: string = new Date().toISOString()
): RunnerVersionTransitionResult {
  if (record.state !== 'in-dev' && record.state !== 'rc-stabilizing') {
    return {
      ok: false,
      reason: `cannot lease a stream in state ${record.state}`,
      record
    };
  }
  const heldUntil = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
  return {
    ok: true,
    reason: `lease granted to ${actorId} until ${heldUntil}`,
    record: { ...record, lease: { heldBy: actorId, heldUntil } }
  };
}
