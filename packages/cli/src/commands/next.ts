import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readActiveGuidanceSession, toGuidanceNextAction } from '../../../core/src/guidance/index.ts';
import type { GuidanceNextAction } from '../../../core/src/guidance/guidance-packet.ts';
import type { LegacyRoutePlan, LegacyRoutePlanSegment } from '../../../core/src/guidance/legacy-route-plan.ts';
import { buildFirstUseUserNotice, type AtmUserNotice } from './first-use-notice.ts';
import { runDoctor } from './doctor.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { describeIntegrationInstallHint, inspectIntegrationBootstrap } from './integration.ts';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.ts';
import { resolveActorId } from './actor-registry.ts';
import { CliError, makeResult, message, parseOptions } from './shared.ts';
import { runTasks } from './tasks.ts';

export async function runNext(argv: any) {
  const { options } = parseOptions(argv, 'next');
  const integrationBootstrap = inspectIntegrationBootstrap(options.cwd);
  const runtimeAdapterReadiness = inspectRuntimeAdapterReadiness(options.cwd);
  const activeGuidanceSession = readActiveGuidanceSession(options.cwd);
  if (activeGuidanceSession) {
    const baseAction = toGuidanceNextAction(activeGuidanceSession.packet, activeGuidanceSession.routeDecision.blockedBy);
    const legacyPlan = activeGuidanceSession.legacyRoutePlan ?? null;
    const nextAction = legacyPlan ? enrichWithLegacyPlan(baseAction, legacyPlan, activeGuidanceSession.sessionId) : baseAction;
    const userNotice = buildFirstUseUserNotice(nextAction);
    return makeResult({
      ok: nextAction.status !== 'blocked',
      command: 'next',
      cwd: options.cwd,
      messages: buildNextMessages(
        nextAction,
        userNotice,
        integrationBootstrap,
        runtimeAdapterReadiness,
        nextAction.status === 'blocked'
          ? message('info', 'ATM_GUIDANCE_NEXT_BLOCKED', 'ATM guidance identified the next single action.', nextAction)
          : message('info', 'ATM_GUIDANCE_NEXT_ACTION', 'ATM guidance identified the next single action.', nextAction)
      ),
      evidence: {
        nextAction,
        agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
        ...(userNotice ? { userNotice } : {}),
        integrationBootstrap,
        runtimeAdapterReadiness,
        guidanceSession: {
          sessionId: activeGuidanceSession.sessionId,
          goal: activeGuidanceSession.goal,
          recommendedRoute: activeGuidanceSession.routeDecision.recommendedRoute,
          confidence: activeGuidanceSession.routeDecision.confidence
        }
      }
    });
  }

  const doctor = await runDoctor(['--cwd', options.cwd]);
  const runtime = detectGovernanceRuntime(options.cwd, bootstrapTaskId);
  const importedTaskQueue = inspectImportedTaskQueue(options.cwd);
  if (options.claim) {
    if (!importedTaskQueue.claimableTask) {
      return makeResult({
        ok: false,
        command: 'next',
        cwd: options.cwd,
        messages: [message('error', 'ATM_NEXT_CLAIM_NO_TASK', 'No claimable imported task is ready at the moment.')],
        evidence: {
          importedTaskQueue
        }
      });
    }
    const resolvedActor = resolveActorId(options.agent ?? undefined);
    if (!resolvedActor) {
      throw new CliError('ATM_ACTOR_ID_MISSING', 'next --claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const claimResult = await runTasks([
      'claim',
      '--cwd',
      options.cwd,
      '--task',
      importedTaskQueue.claimableTask.workItemId,
      '--actor',
      resolvedActor.actorId,
      '--files',
      importedTaskQueue.claimableTask.taskPath,
      '--json'
    ]);
    const nextAction = {
      status: 'ready',
      command: `node atm.mjs start --cwd . --goal ${quoteCliValue(importedTaskQueue.claimableTask.title)} --json`,
      reason: `claimed imported work item ${importedTaskQueue.claimableTask.workItemId} for ${resolvedActor.actorId}`,
      selectedTask: importedTaskQueue.claimableTask,
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
    const userNotice = buildFirstUseUserNotice(nextAction as any);
    return makeResult({
      ok: true,
      command: 'next',
      cwd: options.cwd,
      messages: buildNextMessages(
        nextAction as any,
        userNotice,
        integrationBootstrap,
        runtimeAdapterReadiness,
        message('info', 'ATM_NEXT_CLAIMED', 'Claimed the next imported work item.', {
          taskId: importedTaskQueue.claimableTask.workItemId,
          actorId: resolvedActor.actorId
        })
      ),
      evidence: {
        nextAction,
        claimResult: claimResult.evidence,
        importedTaskQueue,
        integrationBootstrap,
        runtimeAdapterReadiness
      }
    });
  }
  const doctorChecks = doctor.evidence.checks as Array<{ name: string; ok: boolean }>;
  const failed = doctorChecks.find((check) => check.ok !== true);
  const nextAction = decideNextAction(runtime, failed?.name ?? null, importedTaskQueue);
  const userNotice = buildFirstUseUserNotice(nextAction);
  return makeResult({
    ok: nextAction.status === 'ready',
    command: 'next',
    cwd: options.cwd,
    messages: buildNextMessages(
      nextAction,
      userNotice,
      integrationBootstrap,
      runtimeAdapterReadiness,
      nextAction.status === 'ready'
        ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction)
        : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction)
    ),
    evidence: {
      nextAction,
      agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
      ...(userNotice ? { userNotice } : {}),
      integrationBootstrap,
      runtimeAdapterReadiness,
      importedTaskQueue,
      doctorSummary: doctorChecks.map((check) => ({ name: check.name, ok: check.ok })),
      layoutVersion: runtime.layoutVersion,
      currentTaskId: runtime.currentTaskId,
      lockOwner: runtime.activeLock?.owner ?? null,
      lastEvidenceAt: runtime.lastEvidenceAt,
      lastHandoffAt: runtime.lastHandoffAt
    }
  });
}

function decideNextAction(runtime: any, failedCheckName: any, importedTaskQueue: ImportedTaskQueue) {
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

function allowedGuidanceBootstrapCommands() {
  return [
    'node atm.mjs orient --cwd . --json',
    'node atm.mjs start --cwd . --goal "<goal>" --json',
    'node atm.mjs next --cwd . --json',
    'node atm.mjs explain --why blocked --json'
  ];
}

function blockedMutationCommands() {
  return [
    'host mutation without active guidance session',
    'atomize/infect/split apply without dry-run proposal',
    'apply without human review approval'
  ];
}

interface ImportedTaskSummary {
  readonly workItemId: string;
  readonly title: string;
  readonly status: string;
  readonly milestone: string | null;
  readonly dependencies: readonly string[];
  readonly taskPath: string;
}

interface ImportedTaskQueue {
  readonly taskStorePath: string;
  readonly openTaskCount: number;
  readonly selectedTask: ImportedTaskSummary | null;
  readonly claimableTask: ImportedTaskSummary | null;
  readonly tasks: readonly ImportedTaskSummary[];
}

function inspectImportedTaskQueue(cwd: string): ImportedTaskQueue {
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(taskStorePath)) {
    return {
      taskStorePath: '.atm/history/tasks',
      openTaskCount: 0,
      selectedTask: null,
      claimableTask: null,
      tasks: []
    };
  }

  const allTasks = readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ImportedTaskSummary[] => {
      const filePath = path.join(taskStorePath, entry);
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        const schemaVersion = typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : '';
        if (schemaVersion !== 'atm.workItem.v0.2' && parsed.source === undefined) {
          return [];
        }
        const workItemId = typeof parsed.workItemId === 'string'
          ? parsed.workItemId
          : typeof parsed.id === 'string'
            ? parsed.id
            : '';
        if (!workItemId) return [];
        const dependencies = Array.isArray(parsed.dependencies)
          ? parsed.dependencies.filter((entry): entry is string => typeof entry === 'string')
          : [];
        return [{
          workItemId,
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : workItemId,
          status: typeof parsed.status === 'string' ? parsed.status : 'planned',
          milestone: typeof parsed.milestone === 'string' ? parsed.milestone : null,
          dependencies,
          taskPath: path.relative(cwd, filePath).replace(/\\/g, '/')
        }];
      } catch {
        return [];
      }
    });

  const tasks = allTasks
    .filter((task) => task.status === 'ready' || task.status === 'open' || task.status === 'planned')
    .sort((left, right) => {
      const statusWeight = statusQueueWeight(left.status) - statusQueueWeight(right.status);
      return statusWeight !== 0 ? statusWeight : left.workItemId.localeCompare(right.workItemId);
    });
  const statusById = new Map(allTasks.map((task) => [task.workItemId, task.status]));
  const selectedTask = tasks.find((task) => task.dependencies.every((dependency) => {
    const status = statusById.get(dependency);
    return status === 'done' || status === 'verified';
  })) ?? null;
  const claimableTask = tasks.find((task) => task.status === 'ready' && task.dependencies.every((dependency) => {
    const status = statusById.get(dependency);
    return status === 'done' || status === 'verified';
  })) ?? null;

  return {
    taskStorePath: path.relative(cwd, taskStorePath).replace(/\\/g, '/'),
    openTaskCount: tasks.length,
    selectedTask,
    claimableTask,
    tasks
  };
}

function statusQueueWeight(status: string): number {
  if (status === 'ready') return 0;
  if (status === 'open') return 1;
  if (status === 'planned') return 2;
  return 3;
}

function enrichWithLegacyPlan(base: GuidanceNextAction, plan: LegacyRoutePlan, sessionId: string): GuidanceNextAction {
  const safeSegments = plan.segments.filter((s: LegacyRoutePlanSegment) => plan.safeFirstAtoms.includes(s.symbolName));
  const preferredSegment: LegacyRoutePlanSegment | null =
    safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'split')
    ?? safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'infect')
    ?? safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'atomize')
    ?? null;
  const blockedSegments: readonly string[] = plan.trunkFunctions;

  if (!preferredSegment) {
    return {
      ...base,
      status: 'blocked',
      reason: 'No safe leaf segment is available in the LegacyRoutePlan. Submit a split proposal before proceeding.',
      blockedSegments
    };
  }

  const legacyTarget = `${plan.targetFile}#${preferredSegment.symbolName}`;
  const command = `node atm.mjs upgrade --propose --behavior behavior.${preferredSegment.recommendedBehavior} --legacy-target ${quoteCliValue(legacyTarget)} --guidance-session ${quoteCliValue(sessionId)} --dry-run --json`;

  return {
    ...base,
    status: 'action',
    command,
    allowedCommands: Array.from(new Set([...base.allowedCommands, command])),
    selectedSegment: preferredSegment.symbolName,
    legacyTarget,
    targetFile: plan.targetFile,
    selectedBehavior: preferredSegment.recommendedBehavior,
    blockedSegments
  };
}

function quoteCliValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function mapStatusToSlashCommandId(status: string): string {
  if (status === 'needs-bootstrap' || status === 'needs-onboarding-refresh') {
    return 'atm-next';
  }
  if (status === 'needs-guidance-start') {
    return 'atm-orient';
  }
  if (status === 'needs-evidence' || status === 'needs-validation' || status === 'blocked') {
    return 'atm-evidence';
  }
  if (status === 'needs-handoff') {
    return 'atm-handoff';
  }
  return 'atm-next';
}

function buildAgentPackHint(status: string, command: string, reason: string) {
  return {
    slashCommandId: mapStatusToSlashCommandId(status),
    route: status,
    command,
    reason
  };
}

function buildNextMessages(
  nextAction: { readonly status: string },
  userNotice: AtmUserNotice | null,
  integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>,
  runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>,
  routeMessage: ReturnType<typeof message>
) {
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
  messages.push(routeMessage);
  return messages;
}
