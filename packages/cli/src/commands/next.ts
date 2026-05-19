import { readActiveGuidanceSession, toGuidanceNextAction } from '../../../core/src/guidance/index.ts';
import type { GuidanceNextAction } from '../../../core/src/guidance/guidance-packet.ts';
import type { LegacyRoutePlan, LegacyRoutePlanSegment } from '../../../core/src/guidance/legacy-route-plan.ts';
import { buildFirstUseUserNotice } from './first-use-notice.ts';
import { runDoctor } from './doctor.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { makeResult, message, parseOptions } from './shared.ts';

export async function runNext(argv: any) {
  const { options } = parseOptions(argv, 'next');
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
      messages: [message('info', nextAction.status === 'blocked' ? 'ATM_GUIDANCE_NEXT_BLOCKED' : 'ATM_GUIDANCE_NEXT_ACTION', 'ATM guidance identified the next single action.', nextAction)],
      evidence: {
        nextAction,
        agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
        ...(userNotice ? { userNotice } : {}),
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
  const doctorChecks = doctor.evidence.checks as Array<{ name: string; ok: boolean }>;
  const failed = doctorChecks.find((check) => check.ok !== true);
  const nextAction = decideNextAction(runtime, failed?.name ?? null);
  const userNotice = buildFirstUseUserNotice(nextAction);
  return makeResult({
    ok: nextAction.status === 'ready',
    command: 'next',
    cwd: options.cwd,
    messages: [nextAction.status === 'ready' ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction) : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction)],
    evidence: {
      nextAction,
      agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
      ...(userNotice ? { userNotice } : {}),
      doctorSummary: doctorChecks.map((check) => ({ name: check.name, ok: check.ok })),
      layoutVersion: runtime.layoutVersion,
      currentTaskId: runtime.currentTaskId,
      lockOwner: runtime.activeLock?.owner ?? null,
      lastEvidenceAt: runtime.lastEvidenceAt,
      lastHandoffAt: runtime.lastHandoffAt
    }
  });
}

function decideNextAction(runtime: any, failedCheckName: any) {
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
