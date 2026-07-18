import { buildFirstUseUserNotice } from '../first-use-notice.ts';
import { buildFrameworkTempClaimCommand, createFrameworkModeStatus } from '../framework-development.ts';
import { inspectIntegrationBootstrap } from '../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
import { makeResult, message } from '../shared.ts';
import { allowedGuidanceBootstrapCommands, blockedMutationCommands, selectQuickfixChannel } from './channel-strategy.ts';
import { buildNonPlaybookRouteHints, resolveQuickfixScope } from './route-resolution.ts';
import { isQuickfixPrompt } from '../work-channels.ts';
import { isFrameworkMaintenancePrompt } from './route-predicates.ts';
import type { TaskIntent } from './intent-normalizers.ts';
import { buildAgentPackHint, buildChannelPlaybook, buildGovernanceReadinessHint, buildNextMessages } from './playbook-projection.ts';
import type { ImportedTaskQueue } from './route-predicates.ts';
import { quoteCliValue, toTaskCandidateView } from './view-projections.ts';
import type { NextActionLike } from './next-action-assembly.ts';

export function buildPromptGuidanceNextResult(input: {
  readonly cwd: string;
  readonly actor?: string;
  readonly taskIntent: TaskIntent | null;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  const prompt = input.taskIntent?.userPrompt?.trim();
  if (!prompt || input.taskIntent?.taskScopeMentioned === true) return null;
  const quickfixScope = resolveQuickfixScope(prompt);
  if (isQuickfixPrompt(prompt) && quickfixScope.length > 0) {
    const nextAction: NextActionLike = {
      status: 'quickfix-ready',
      command: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(prompt)} --json`,
      reason: 'the prompt looks like a small targeted fix with path-like scope, so ATM can use the fast quickfix channel',
      recommendedChannel: 'fast',
      riskLevel: 'low',
      playbook: buildChannelPlaybook({
        channel: 'fast',
        originalPrompt: prompt
      }),
      governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
        channel: 'fast',
        prompt,
        actorId: input.actor,
        ownFiles: quickfixScope
      }),
      allowedFiles: quickfixScope,
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
        message('info', 'ATM_NEXT_QUICKFIX_ROUTE_READY', 'ATM routed this prompt to the fast quickfix channel.', {
          requiredCommand: nextAction.command,
          allowedFiles: quickfixScope
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'fast',
        taskIntent: input.taskIntent,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  const frameworkStatus = createFrameworkModeStatus({ cwd: input.cwd });
  if (frameworkStatus.repoIdentity.isFrameworkRepo && isFrameworkMaintenancePrompt(prompt)) {
    const claimCommand = buildFrameworkTempClaimCommand([], prompt);
    const nextAction: NextActionLike = {
      status: 'framework-temp-claim-required',
      command: claimCommand,
      reason: 'the prompt appears to be ATM framework maintenance without a human task card, so use a temporary runtime claim before editing critical framework files',
      recommendedChannel: 'fast',
      riskLevel: 'high',
      playbook: buildChannelPlaybook({
        channel: 'fast',
        originalPrompt: prompt,
        fastClaimCommand: claimCommand,
        fastClaimLabel: 'framework temp claim'
      }),
      governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
        channel: 'fast',
        prompt,
        actorId: input.actor,
        frameworkClaimRequired: true
      }),
      allowedCommands: [
        claimCommand,
        'node atm.mjs framework-mode status --json',
        'node atm.mjs guard framework-development --json'
      ],
      blockedCommands: [
        'editing framework critical files before framework-mode claim',
        'creating AI-authored permanent task cards in .atm/history/tasks'
      ]
    };
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
        message('info', 'ATM_NEXT_FRAMEWORK_TEMP_CLAIM_REQUIRED', 'ATM detected framework maintenance without a scoped task; acquire a temporary framework runtime claim before editing.', {
          requiredCommand: claimCommand
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'fast',
        agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
        taskIntent: input.taskIntent,
        frameworkStatus,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  const nextAction: NextActionLike = {
    status: 'prompt-guidance-required',
    command: `node atm.mjs guide --goal ${quoteCliValue(prompt)} --cwd . --json`,
    reason: 'the user supplied a prompt that is not task-scoped, so ATM routes guidance from that prompt instead of reusing stale global guidance',
    recommendedChannel: null,
    riskLevel: 'medium',
    governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
      channel: null,
      prompt,
      actorId: input.actor
    }),
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands(),
    ...buildNonPlaybookRouteHints(input.cwd, prompt)
  };
  const userNotice = buildFirstUseUserNotice(nextAction);
  return makeResult({
    ok: true,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      userNotice,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message('info', 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED', 'ATM routed next-action guidance from the current prompt instead of stale global state.', {
        command: nextAction.command
      })
    ),
    evidence: {
      nextAction,
      agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
      ...(userNotice ? { userNotice } : {}),
      taskIntent: input.taskIntent,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
}

export function buildPromptRequiredNextResult(input: {
  readonly cwd: string;
  readonly claimRequested: boolean;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  const candidatePreview = input.importedTaskQueue.tasks.slice(0, 12).map(toTaskCandidateView);
  const nextAction: NextActionLike = {
    status: 'prompt-required',
    command: 'node atm.mjs next --prompt "<current user prompt>" --json',
    reason: 'task cards exist, but no current user prompt was provided; ATM will not choose a global task or batch by accident',
    recommendedChannel: null,
    riskLevel: 'medium',
    candidateCount: input.importedTaskQueue.tasks.length,
    candidates: candidatePreview,
    batchInstruction: 'If the user asked for all task cards, a whole plan, or multiple tasks, rerun with the original prompt so ATM can return recommendedChannel=batch and require batch checkpoint.',
    allowedCommands: [
      'node atm.mjs next --prompt "<current user prompt>" --json',
      'node atm.mjs next --claim --actor <id> --prompt "<current user prompt>" --auto-intent --json'
    ],
    blockedCommands: [
      'manual tasks claim/close loops without prompt-scoped next',
      'batch task closure without node atm.mjs batch checkpoint --actor <id> --json'
    ]
  };
  return makeResult({
    ok: false,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      null,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message(
        'error',
        input.claimRequested ? 'ATM_NEXT_CLAIM_PROMPT_REQUIRED' : 'ATM_NEXT_PROMPT_REQUIRED_FOR_TASK_ROUTING',
        'ATM found task cards, but no user prompt was provided. Rerun next with the current user prompt so ATM can choose fast, normal, or batch correctly.',
        {
          requiredCommand: nextAction.command,
          candidateCount: nextAction.candidateCount,
          batchInstruction: nextAction.batchInstruction
        }
      )
    ),
    evidence: {
      nextAction,
      importedTaskQueue: input.importedTaskQueue,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
}
