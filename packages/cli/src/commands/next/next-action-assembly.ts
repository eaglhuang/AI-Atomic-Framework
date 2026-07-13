import {
  decisionResultForStatus,
  type NextDecisionTrailEntry
} from './match-and-sort.ts';

export type NextActionTeamRecommendationLike = {
  readonly schemaId: string;
  readonly enabled: boolean;
  readonly reason: string;
  readonly plan: string;
  readonly start: string;
  readonly status: string;
  readonly recipeId: string;
  readonly taskId: string | null;
  readonly knowledgeSummary?: unknown;
};

export type NextActionLike = {
  status: string;
  command?: string;
  reason?: string;
  recommendedChannel?: string | null;
  riskLevel?: string;
  selectedTask?: unknown;
  selectedTasks?: unknown;
  taskQueue?: unknown;
  queueHeadTaskId?: string | null;
  batchId?: string | null;
  taskDirectionLock?: { readonly taskId?: string; readonly schemaId?: string };
  brokerQueueAdmission?: unknown;
  deliveryPrinciple?: unknown;
  playbook?: {
    readonly channel: string;
    readonly [key: string]: unknown;
  };
  teamRecommendation?: NextActionTeamRecommendationLike | null;
  allowedCommands?: readonly string[];
  blockedCommands?: readonly string[];
  missingEvidence?: readonly string[];
  requiredCommand?: string | null;
  closure?: {
    readonly taskId?: string;
    readonly status?: string;
    readonly closedAt?: string | null;
    readonly closedByActor?: string | null;
    readonly lastTransitionId?: string | null;
    readonly lastTransitionAt?: string | null;
    readonly closurePacketPath?: string | null;
  };
  planningStatusSync?: {
    readonly authority?: string;
    readonly instruction?: string;
  };
  claimIntent?: string | null;
  quickfixLock?: unknown;
  allowedFiles?: readonly string[];
  candidateCount?: number;
  candidates?: readonly unknown[];
  batchInstruction?: unknown;
  batchRun?: unknown;
  scopeKey?: string | null;
  sessionId?: string | null;
  actorSession?: unknown;
  scopeDiagnostic?: unknown;
  ignoredUntrackedFiles?: readonly string[];
  planningContext?: unknown;
  targetWork?: unknown;
  taskContext?: unknown;
  deliveryClassification?: unknown;
  mirrorSync?: unknown;
  decisionTrail?: NextDecisionTrailEntry[];
  playbookState?: 'present' | 'absent';
  structuredOutputHint?: {
    readonly schemaId: 'atm.nextStructuredOutputHint.v1';
    readonly hasPlaybook: boolean;
    readonly treatCliJsonAs: 'structured-tool-guidance';
    readonly followNextActionField: 'evidence.nextAction.command';
  };
  ignoredArtifactForceAddHints?: readonly {
    readonly path: string;
    readonly requiredCommand: string;
    readonly reason: string;
  }[];
  promptWorktreeHint?: {
    readonly schemaId: 'atm.promptWorktreeHint.v1';
    readonly promptPathHints: readonly string[];
    readonly promptMatchedFiles: readonly string[];
    readonly atmManagedFiles: readonly string[];
    readonly generatedArtifactFiles: readonly string[];
    readonly releaseMirrorFiles: readonly string[];
    readonly unrelatedTrackedFiles: readonly string[];
    readonly unrelatedUntrackedFiles: readonly string[];
    readonly ignoredArtifactCount: number;
    readonly note: string;
  };
  governanceReadiness?: {
    readonly schemaId: 'atm.nextGovernanceReadinessHint.v1';
    readonly channel: string | null;
    readonly currentBranch: string | null;
    readonly upstreamRef: string | null;
    readonly protectedBranchTarget: boolean;
    readonly aheadCount: number;
    readonly frameworkClaimRequired: boolean;
    readonly earlyPreparation: readonly string[];
    readonly queueRetryCodes: readonly string[];
    readonly perCriticalCommitGitHeadEvidence?: {
      readonly enforcement: string;
      readonly retainedStrictBoundaries: readonly string[];
    };
    readonly protectedPushHint: string | null;
  };
};

export function ensureDecisionTrail(nextAction: NextActionLike) {
  if (Array.isArray(nextAction.decisionTrail) && nextAction.decisionTrail.length > 0) {
    return nextAction;
  }
  nextAction.decisionTrail = buildDecisionTrail(nextAction);
  return nextAction;
}

export function buildDecisionTrail(nextAction: NextActionLike): NextDecisionTrailEntry[] {
  const entries: NextDecisionTrailEntry[] = [{
    check: 'route-status',
    result: decisionResultForStatus(nextAction.status),
    reason: nextAction.reason ?? `ATM selected route status ${nextAction.status}.`,
    ...(nextAction.command ? { nextCommand: nextAction.command } : {})
  }];

  const selectedTaskId = readTaskId(nextAction.selectedTask);
  if (selectedTaskId) {
    entries.push({
      check: 'task-selection',
      result: 'pass',
      reason: `Selected task ${selectedTaskId}.`
    });
  } else if (Array.isArray(nextAction.selectedTasks)) {
    entries.push({
      check: 'task-selection',
      result: nextAction.selectedTasks.length > 0 ? 'pass' : 'blocked',
      reason: `Selected ${nextAction.selectedTasks.length} task candidate(s).`
    });
  }

  if (nextAction.status === 'task-scope-not-found') {
    entries.push({
      check: 'prompt-scope-resolution',
      result: 'blocked',
      reason: 'No matching task scope was found; ATM did not fall back to unrelated task cards.'
    });
  }

  if (nextAction.status === 'task-no-work') {
    entries.push({
      check: 'prompt-scope-resolution',
      result: 'pass',
      reason: 'The scoped prompt resolved cleanly, but no open imported work remains for that scope.'
    });
  }

  if (nextAction.status === 'task-selection-required') {
    entries.push({
      check: 'prompt-scope-resolution',
      result: 'blocked',
      reason: 'Multiple task scopes matched; ATM requires a more specific prompt before routing.'
    });
  }

  if (nextAction.recommendedChannel) {
    entries.push({
      check: 'work-channel',
      result: 'info',
      reason: `Recommended ${nextAction.recommendedChannel} channel with ${nextAction.riskLevel ?? 'unknown'} risk.`
    });
  }

  const queueHeadTaskId = nextAction.queueHeadTaskId ?? readQueueHeadTaskId(nextAction.taskQueue);
  if (queueHeadTaskId) {
    entries.push({
      check: 'queue-head',
      result: 'pass',
      reason: `Current queue head is ${queueHeadTaskId}.`
    });
  }

  if (nextAction.taskDirectionLock?.schemaId === 'atm.taskDirectionLock.v1') {
    const taskId = nextAction.taskDirectionLock.taskId ?? selectedTaskId ?? queueHeadTaskId ?? '<task>';
    entries.push({
      check: 'task-direction-lock',
      result: 'pass',
      reason: `Task direction lock is active for ${taskId}.`,
      evidencePath: `.atm/runtime/locks/${taskId}.lock.json`
    });
  }

  if (Array.isArray(nextAction.missingEvidence) && nextAction.missingEvidence.length > 0) {
    entries.push({
      check: 'missing-evidence',
      result: 'blocked',
      reason: `Missing evidence: ${nextAction.missingEvidence.join(', ')}.`
    });
  }

  if (nextAction.closure?.closurePacketPath) {
    entries.push({
      check: 'closure-state',
      result: 'pass',
      reason: 'Task closure packet is available.',
      evidencePath: nextAction.closure.closurePacketPath
    });
  }

  if (Array.isArray(nextAction.allowedCommands) && nextAction.allowedCommands.length > 0) {
    entries.push({
      check: 'allowed-commands',
      result: 'info',
      reason: `${nextAction.allowedCommands.length} allowed command(s) are exposed for the route.`
    });
  }

  if (Array.isArray(nextAction.blockedCommands) && nextAction.blockedCommands.length > 0) {
    entries.push({
      check: 'blocked-commands',
      result: 'info',
      reason: `${nextAction.blockedCommands.length} blocked command pattern(s) are exposed for the route.`
    });
  }

  return entries;
}

export function readTaskId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as { readonly workItemId?: unknown }).workItemId;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

export function readQueueHeadTaskId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as { readonly queueHeadTaskId?: unknown }).queueHeadTaskId;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}
