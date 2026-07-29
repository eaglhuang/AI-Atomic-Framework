import type { MutationOperation } from '@ai-atomic-framework/core';
import { evaluateLaneMutation } from './mutation-authority-adapter.ts';
import { CliError, makeResult, message } from '../shared.ts';

/**
 * Read-only `lane mutation-status` diagnostic. Reports the composed
 * lane + capability mutation decision for a task/operation without carrying a
 * token store, exposing only decision classes and fingerprints — never a
 * reusable capability, lease, or ticket key. Extracted from lane.ts to keep
 * that command within its physical line budget.
 */

export const mutationOperations: readonly MutationOperation[] = [
  'task-renew',
  'task-release',
  'task-handoff',
  'task-takeover',
  'governed-commit',
  'governed-push',
  'framework-mode-claim',
  'framework-mode-release',
  'runner-sync-reserve',
  'runner-sync-publish',
  'taskflow-close'
];

export interface LaneMutationStatusInput {
  readonly cwd: string;
  readonly taskId: string | null;
  readonly actorId: string | null;
  readonly laneSessionId: string | null;
  readonly reason: string | null;
  readonly operation: string | null;
}

export function runLaneMutationStatus(options: LaneMutationStatusInput) {
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'lane mutation-status requires --task', { exitCode: 2 });
  }
  const operation = (options.operation ?? 'taskflow-close') as MutationOperation;
  if (!mutationOperations.includes(operation)) {
    throw new CliError(
      'ATM_CLI_USAGE',
      `lane mutation-status --operation must be one of: ${mutationOperations.join(', ')}`,
      { exitCode: 2 }
    );
  }
  const decision = evaluateLaneMutation({
    cwd: options.cwd,
    taskId: options.taskId,
    actorId: options.actorId ?? '(unspecified)',
    operation,
    resource: options.reason ?? `diagnostic:${operation}`,
    executingLaneSessionId: options.laneSessionId
  });
  // Project the composed decision to a redacted, non-replayable view.
  const redacted = {
    operation: decision.operation,
    taskId: decision.taskId,
    actorId: decision.actorId,
    allowed: decision.allowed,
    blockedBy: decision.blockedBy,
    laneDecisionClass: decision.laneDecision.decisionClass,
    capabilityDecisionClass: decision.capabilityDecision.decisionClass,
    ownerLaneFingerprint: decision.laneDecision.ownerLaneFingerprint,
    executingLaneFingerprint: decision.laneDecision.executingLaneFingerprint,
    reason: decision.reason
  };
  return makeResult({
    ok: true,
    command: 'lane',
    cwd: options.cwd,
    messages: [
      message(
        'info',
        'ATM_LANE_MUTATION_STATUS',
        `Mutation ${operation} on ${options.taskId}: ${decision.allowed ? 'authorized' : 'blocked'}.`,
        { allowed: decision.allowed, blockedBy: decision.blockedBy }
      )
    ],
    evidence: { action: 'mutation-status', decision: redacted }
  });
}
