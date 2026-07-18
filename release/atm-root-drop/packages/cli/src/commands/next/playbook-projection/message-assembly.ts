// @ts-nocheck
import { buildTeamRecommendation } from '../../team.ts';
import { inspectIntegrationBootstrap, describeIntegrationInstallHint } from '../../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../../runtime-adapter-readiness.ts';
import { ensureDecisionTrail, readTaskId } from '../next-action-assembly.ts';
import { shouldEmitPromptWorktreeHint } from '../worktree-hints.ts';
import { message } from '../../shared.ts';
import { buildTaskDeliveryPrinciple } from './channel-playbook.ts';

export function embedTeamRecommendation<T extends { readonly playbook?: unknown }>(
  nextAction: T,
  input: Parameters<typeof buildTeamRecommendation>[0]
): T & { teamRecommendation?: TeamRecommendation | null } {
  const teamRecommendation = buildTeamRecommendation(input);
  if (!teamRecommendation) {
    return nextAction;
  }
  const playbook = nextAction.playbook && typeof nextAction.playbook === 'object' && !Array.isArray(nextAction.playbook)
    ? { ...(nextAction.playbook as Record<string, unknown>), teamRecommendation }
    : nextAction.playbook;
  return {
    ...nextAction,
    teamRecommendation,
    playbook
  };
}

export function buildNextMessages(
  nextAction: NextActionLike,
  userNotice: AtmUserNotice | null,
  integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>,
  runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>,
  routeMessage: ReturnType<typeof message>
) {
  ensureDecisionTrail(nextAction);
  const messages = [];
  if (userNotice) {
    messages.push(message('info', 'ATM_USER_NOTICE', userNotice.spokenLine, {
      displayPolicy: userNotice.displayPolicy,
      mustShowBeforeAction: userNotice.mustShowBeforeAction,
      agentInstruction: userNotice.agentInstruction,
      afterNextActionInstruction: userNotice.afterNextActionInstruction,
      route: nextAction.status
    }));
  }
  const integrationInstallHint = describeIntegrationInstallHint(integrationBootstrap);
  if (integrationInstallHint) {
    messages.push(message(
      'warning',
      'ATM_NEXT_INTEGRATION_INSTALL_RECOMMENDED',
      integrationInstallHint.text,
      integrationInstallHint.data
    ));
  }
  if (runtimeAdapterReadiness.needsRuntimeAdapterHint) {
    messages.push(message(
      'warning',
      'ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED',
      runtimeAdapterReadiness.suggestedAction ?? 'Python entrypoints were detected. Select a Python runtime adapter/plugin before expecting ATM atom birth or apply routes to mutate Python surfaces.',
      {
        detectedLanguages: runtimeAdapterReadiness.detectedLanguages,
        bundledLanguageAdapters: runtimeAdapterReadiness.bundledLanguageAdapters,
        bundledProjectAdapters: runtimeAdapterReadiness.bundledProjectAdapters,
        pythonLanguageAdapterAvailable: runtimeAdapterReadiness.pythonLanguageAdapterAvailable,
        candidateRankingAllowed: runtimeAdapterReadiness.candidateRankingAllowed,
        atomBirthApplyDeferred: runtimeAdapterReadiness.atomBirthApplyDeferred,
        missingCapability: runtimeAdapterReadiness.missingCapability
      }
    ));
  }
  if (nextAction.playbook) {
    messages.push(message(
      'warning',
      'ATM_CHANNEL_PLAYBOOK_REQUIRED',
      `Follow the ${nextAction.playbook.channel} playbook exactly before editing, closing, or committing.`,
      nextAction.playbook
    ));
    if (nextAction.playbook.channel === 'normal') {
      messages.push(message(
        'info',
        'ATM_TASK_CLOSE_REMINDER',
        'Normal task cards are not finished at validators or evidence: after deliverables exist, always run tasks close before committing.',
        {
          schemaId: 'atm.taskCloseReminder.v1',
          taskId: readTaskId(nextAction.selectedTask) ?? nextAction.queueHeadTaskId ?? null,
          playbookChannel: 'normal'
        }
      ));
    }
  } else if (nextAction.playbookState === 'absent') {
    messages.push(message(
      'info',
      'ATM_NEXT_PLAYBOOK_ABSENT',
      'This route has no channel playbook. Treat the CLI JSON as structured ATM guidance and follow evidence.nextAction.command as the single next action before mutating files.',
      nextAction.structuredOutputHint ?? {
        schemaId: 'atm.nextStructuredOutputHint.v1',
        hasPlaybook: false,
        treatCliJsonAs: 'structured-tool-guidance',
        followNextActionField: 'evidence.nextAction.command'
      }
    ));
  }
  if ((nextAction.ignoredArtifactForceAddHints?.length ?? 0) > 0) {
    messages.push(message(
      'warning',
      'ATM_NEXT_IGNORED_ARTIFACT_FORCE_ADD_HINT',
      'ATM found ignored artifact paths in the current worktree. If one of them is the intended deliverable for the selected route, force-add it explicitly instead of assuming normal git add will see it.',
      {
        schemaId: 'atm.ignoredArtifactForceAddHints.v1',
        hints: nextAction.ignoredArtifactForceAddHints
      }
    ));
  }
  const promptWorktreeHint = nextAction.promptWorktreeHint;
  if (shouldEmitPromptWorktreeHint(promptWorktreeHint)) {
    messages.push(message(
      'info',
      'ATM_NEXT_WORKTREE_SCOPE_HINT',
      'ATM classified current dirty files before task selection so you can distinguish prompt-matched hints from unrelated or generated residue.',
      promptWorktreeHint
    ));
  }
  const deliveryPrinciple = nextAction.deliveryPrinciple
    ?? (nextAction.selectedTask || nextAction.selectedTasks ? buildTaskDeliveryPrinciple({ channel: nextAction.selectedTasks ? 'batch' : 'normal' }) : null);
  if (deliveryPrinciple) {
    messages.push(message(
      'warning',
      'ATM_TASK_DELIVERY_PRINCIPLE',
      'Task cards are not targets to close; they are delivery contracts. Implement the requested non-.atm deliverables before closing.',
      deliveryPrinciple
    ));
  }
  if (nextAction.teamRecommendation?.enabled) {
    messages.push(message(
      'info',
      'ATM_TEAM_RECOMMENDATION',
      nextAction.teamRecommendation.reason,
      {
        schemaId: nextAction.teamRecommendation.schemaId,
        plan: nextAction.teamRecommendation.plan,
        start: nextAction.teamRecommendation.start,
        status: nextAction.teamRecommendation.status,
        recipeId: nextAction.teamRecommendation.recipeId,
        taskId: nextAction.teamRecommendation.taskId,
        ...(nextAction.teamRecommendation.knowledgeSummary ? {
          knowledgeSummary: nextAction.teamRecommendation.knowledgeSummary
        } : {})
      }
    ));
  }
  if (nextAction.governanceReadiness) {
    const readinessRecord = nextAction.governanceReadiness as Record<string, unknown>;
    const activeWorkSummary = readinessRecord.activeWorkSummary && typeof readinessRecord.activeWorkSummary === 'object' && !Array.isArray(readinessRecord.activeWorkSummary)
      ? readinessRecord.activeWorkSummary as Record<string, unknown>
      : null;
    const brokerRecommendation = activeWorkSummary?.brokerRecommendation && typeof activeWorkSummary.brokerRecommendation === 'object' && !Array.isArray(activeWorkSummary.brokerRecommendation)
      ? activeWorkSummary.brokerRecommendation as Record<string, unknown>
      : null;
    const teamLevelRecommendation = activeWorkSummary?.teamLevelRecommendation && typeof activeWorkSummary.teamLevelRecommendation === 'object' && !Array.isArray(activeWorkSummary.teamLevelRecommendation)
      ? activeWorkSummary.teamLevelRecommendation as Record<string, unknown>
      : null;
    if (brokerRecommendation?.enabled === true) {
      messages.push(message(
        'warning',
        'ATM_ACTIVE_WORK_BROKER_RECOMMENDED',
        `ATM detected active concurrent work; consider Team Agent Broker ${teamLevelRecommendation?.level ?? 'L3'} before editing.`,
        {
          schemaId: activeWorkSummary?.schemaId ?? 'atm.activeWorkSummary.v1',
          brokerRecommendation,
          teamLevelRecommendation,
          activeActors: activeWorkSummary?.activeActors ?? [],
          activeClaims: activeWorkSummary?.activeClaims ?? [],
          stagedFiles: activeWorkSummary?.stagedFiles ?? []
        }
      ));
    }
    messages.push(message(
      'info',
      'ATM_NEXT_GOVERNANCE_READINESS_HINT',
      'ATM surfaced the governance prerequisites early so the agent can prepare claim, evidence, and protected-push checks before reaching commit or push.',
      nextAction.governanceReadiness
    ));
  }
  messages.push(routeMessage);
  return messages;
}
