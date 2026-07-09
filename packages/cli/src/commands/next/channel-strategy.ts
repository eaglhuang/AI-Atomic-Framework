import type { ImportedTaskQueue } from './route-predicates.ts';
import { quoteCliValue } from './view-projections.ts';

export type NextWorkChannel = 'fast' | 'normal' | 'batch' | 'quickfix' | 'task-route-ready';
export type ChannelRiskLevel = 'low' | 'medium' | 'high';

export interface ChannelStrategyDecision {
  readonly schemaId: 'atm.nextChannelStrategy.v1';
  readonly channel: NextWorkChannel;
  readonly recommendedChannel: string;
  readonly riskLevel: ChannelRiskLevel;
  readonly reason: string;
  readonly stableCode: string;
}

export interface RuntimeNextAction {
  readonly status: string;
  readonly command: string;
  readonly reason: string;
  readonly allowedCommands: readonly string[];
  readonly blockedCommands: readonly string[];
  readonly afterNextAction?: string;
  readonly selectedTask?: unknown;
}

export function allowedGuidanceBootstrapCommands(): readonly string[] {
  return [
    'node atm.mjs orient --cwd . --json',
    'node atm.mjs start --cwd . --goal "<goal>" --json',
    'node atm.mjs next --prompt "<current user prompt>" --json',
    'node atm.mjs next --cwd . --json',
    'node atm.mjs explain --why blocked --json'
  ];
}

export function blockedMutationCommands(): readonly string[] {
  return [
    'host mutation without active guidance session',
    'manual task lifecycle loop without prompt-scoped next',
    'batch task closure without batch checkpoint',
    'atomize/infect/split apply without dry-run proposal',
    'apply without human review approval'
  ];
}

export function decideRuntimeNextAction(
  runtime: Record<string, unknown>,
  failedCheckName: string | null | undefined,
  importedTaskQueue: ImportedTaskQueue
): RuntimeNextAction {
  if (runtime.migrationNeeded || runtime.hasV1 && runtime.hasV2 === false) {
    return {
      status: 'needs-bootstrap',
      command: 'node atm.mjs bootstrap --cwd . --force --task "Bootstrap ATM in this repository"',
      reason: 'legacy layout needs migration to runtime/history/catalog',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (failedCheckName === 'onboarding-lifecycle') {
    return {
      status: 'needs-onboarding-refresh',
      command: 'node atm.mjs atm-chart render --cwd . --json',
      reason: 'onboarding ATMChart sources are missing or stale',
      afterNextAction: 'After this onboarding refresh succeeds, return to the user original request and continue the actual work.',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (!runtime.config) {
    return {
      status: 'needs-bootstrap',
      command: 'node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository"',
      reason: '.atm/config.json is missing',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (!runtime.currentTaskId) {
    if (importedTaskQueue.selectedTask) {
      return {
        status: 'ready',
        command: `node atm.mjs start --cwd . --goal ${quoteCliValue(importedTaskQueue.selectedTask.title)} --json`,
        reason: `imported work item ${importedTaskQueue.selectedTask.workItemId} is ready to start`,
        selectedTask: importedTaskQueue.selectedTask,
        allowedCommands: allowedGuidanceBootstrapCommands(),
        blockedCommands: blockedMutationCommands()
      };
    }
    return {
      status: 'needs-guidance-start',
      command: 'node atm.mjs orient --cwd . --json',
      reason: 'no active guidance session is recorded',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (!runtime.lastEvidenceAt) {
    return {
      status: 'needs-evidence',
      command: `node atm.mjs handoff summarize --task ${runtime.currentTaskId} --json`,
      reason: 'the current governed task does not have recorded evidence yet',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (!runtime.lastHandoffAt) {
    return {
      status: 'needs-handoff',
      command: `node atm.mjs handoff summarize --task ${runtime.currentTaskId} --json`,
      reason: 'the current governed task does not have a handoff summary yet',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (failedCheckName === 'cross-task-mutation-incident') {
    return {
      status: 'incident-safe-mode',
      command: 'git status',
      reason: 'Cross-task mutation incident detected: files owned by another active task or evidence have been modified, deleted, or staged. ATM has entered incident-safe mode.',
      allowedCommands: ['git status', 'git diff', 'node atm.mjs doctor', 'node atm.mjs tasks status'],
      blockedCommands: ['*']
    };
  }
  if (failedCheckName) {
    return {
      status: 'needs-validation',
      command: 'npm run validate:full',
      reason: `doctor reported a failing check: ${failedCheckName}`,
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  return {
    status: 'ready',
    command: 'npm test',
    reason: 'runtime state, governance state, and engineering checks are all green',
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands()
  };
}

export function selectQuickfixChannel(): ChannelStrategyDecision {
  return {
    schemaId: 'atm.nextChannelStrategy.v1',
    channel: 'fast',
    recommendedChannel: 'fast',
    riskLevel: 'low',
    reason: 'quickfix prompt with path-like scope selects the fast channel',
    stableCode: 'ATM_NEXT_CHANNEL_QUICKFIX'
  };
}

export function selectBatchChannel(reason: string): ChannelStrategyDecision {
  return {
    schemaId: 'atm.nextChannelStrategy.v1',
    channel: 'batch',
    recommendedChannel: 'batch',
    riskLevel: 'high',
    reason,
    stableCode: 'ATM_NEXT_CHANNEL_BATCH'
  };
}

export function selectNormalTaskRouteChannel(reason: string): ChannelStrategyDecision {
  return {
    schemaId: 'atm.nextChannelStrategy.v1',
    channel: 'task-route-ready',
    recommendedChannel: 'normal',
    riskLevel: 'medium',
    reason,
    stableCode: 'ATM_NEXT_CHANNEL_TASK_ROUTE_READY'
  };
}

export function selectPostClaimChannel(batchActive: boolean): ChannelStrategyDecision {
  if (batchActive) {
    return selectBatchChannel('claimed task belongs to an active batch queue');
  }
  return {
    schemaId: 'atm.nextChannelStrategy.v1',
    channel: 'normal',
    recommendedChannel: 'normal',
    riskLevel: 'medium',
    reason: 'single-task claim without active batch context',
    stableCode: 'ATM_NEXT_CHANNEL_NORMAL'
  };
}

export function selectUnknownRuntimeChannel(): ChannelStrategyDecision {
  return {
    schemaId: 'atm.nextChannelStrategy.v1',
    channel: 'normal',
    recommendedChannel: 'normal',
    riskLevel: 'medium',
    reason: 'unknown runtime signals fall back to the normal channel with a stable default',
    stableCode: 'ATM_NEXT_CHANNEL_UNKNOWN_FALLBACK'
  };
}

/**
 * Assert the strategy helpers never mutate caller-owned input objects.
 */
export function channelStrategyPreservesInput<T extends object>(input: T, selector: (value: T) => ChannelStrategyDecision): boolean {
  const snapshot = JSON.stringify(input);
  selector(input);
  return JSON.stringify(input) === snapshot;
}
