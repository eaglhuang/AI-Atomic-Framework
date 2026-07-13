export type TeamCommandFastPath =
  | 'handoff'
  | 'knowledge'
  | 'broker'
  | 'observability';

export type TeamParsedAction =
  | 'plan'
  | 'start'
  | 'status'
  | 'validate'
  | 'patrol'
  | 'lease'
  | 'release'
  | 'complete'
  | 'abandon'
  | 'wave'
  | 'knowledge'
  | 'broker'
  | 'observability';

export type TeamRouteKind =
  | 'fast-path'
  | 'special-action'
  | 'status'
  | 'lifecycle'
  | 'patrol'
  | 'planning';

export type TeamRouteResolution =
  | {
    kind: 'fast-path';
    fastPath: TeamCommandFastPath;
    argv: string[];
    cwdSource: 'option-or-process' | 'process';
  }
  | {
    kind: 'special-action';
    action: Extract<TeamParsedAction, 'wave' | 'knowledge' | 'broker' | 'observability'>;
    argv: string[];
  }
  | {
    kind: 'status';
    action: 'status';
  }
  | {
    kind: 'lifecycle';
    action: Extract<TeamParsedAction, 'lease' | 'release' | 'complete' | 'abandon'>;
  }
  | {
    kind: 'patrol';
    action: 'patrol';
  }
  | {
    kind: 'planning';
    action: Extract<TeamParsedAction, 'plan' | 'start' | 'validate'>;
  };

const fastPaths = new Set<TeamCommandFastPath>(['handoff', 'knowledge', 'broker', 'observability']);
const specialActions = new Set(['wave', 'knowledge', 'broker', 'observability']);
const lifecycleActions = new Set(['lease', 'release', 'complete', 'abandon']);
const planningActions = new Set(['plan', 'start', 'validate']);

export function isSupportedTeamAction(action: string): action is TeamParsedAction {
  return action === 'status'
    || action === 'patrol'
    || lifecycleActions.has(action)
    || planningActions.has(action)
    || specialActions.has(action);
}

export function resolveTeamFastPath(argv: readonly string[]): Extract<TeamRouteResolution, { kind: 'fast-path' }> | null {
  const first = String(argv[0] ?? '').toLowerCase();
  if (!fastPaths.has(first as TeamCommandFastPath)) return null;
  return {
    kind: 'fast-path',
    fastPath: first as TeamCommandFastPath,
    argv: argv.slice(1).map(String),
    cwdSource: first === 'broker' ? 'process' : 'option-or-process'
  };
}

export function resolveTeamActionRoute(actionValue: unknown, positionalTail: readonly unknown[]): TeamRouteResolution {
  const action = String(actionValue ?? 'plan').toLowerCase();
  if (!isSupportedTeamAction(action)) {
    return {
      kind: 'planning',
      action: 'plan'
    };
  }
  if (specialActions.has(action)) {
    return {
      kind: 'special-action',
      action: action as Extract<TeamParsedAction, 'wave' | 'knowledge' | 'broker' | 'observability'>,
      argv: positionalTail.map(String)
    };
  }
  if (action === 'status') return { kind: 'status', action };
  if (action === 'patrol') return { kind: 'patrol', action };
  if (lifecycleActions.has(action)) {
    return {
      kind: 'lifecycle',
      action: action as Extract<TeamParsedAction, 'lease' | 'release' | 'complete' | 'abandon'>
    };
  }
  return {
    kind: 'planning',
    action: action as Extract<TeamParsedAction, 'plan' | 'start' | 'validate'>
  };
}

export function supportedTeamActionList(): string {
  return 'plan, start, status, validate, patrol, lease, release, complete, abandon, wave, knowledge, broker resolve, observability query';
}
