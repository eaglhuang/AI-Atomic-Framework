import type { CommandResult } from '../../shared.ts';
import type { LegacyClaimLifecycleAction } from './compat-command-map.ts';

export interface LegacyTransitionCompatLane {
  readonly claimLifecycle: (action: LegacyClaimLifecycleAction, argv: string[]) => Promise<CommandResult> | CommandResult;
  readonly deliverAndClose: (argv: string[]) => Promise<CommandResult> | CommandResult;
}

export function createTransitionCompatLane(lane: LegacyTransitionCompatLane): LegacyTransitionCompatLane {
  return lane;
}
