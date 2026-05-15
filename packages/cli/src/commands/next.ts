import { readActiveGuidanceSession, toGuidanceNextAction } from '../../../core/src/guidance/index.ts';
import type { GuidanceNextAction } from '../../../core/src/guidance/guidance-packet.ts';
import type { LegacyRoutePlan, LegacyRoutePlanSegment } from '../../../core/src/guidance/legacy-route-plan.ts';
import { runDoctor } from './doctor.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { makeResult, message, parseOptions } from './shared.ts';

export function runNext(argv: any) {
  const { options } = parseOptions(argv, 'next');
  const activeGuidanceSession = readActiveGuidanceSession(options.cwd);
  if (activeGuidanceSession) {
    const baseAction = toGuidanceNextAction(activeGuidanceSession.packet, activeGuidanceSession.routeDecision.blockedBy);
    const legacyPlan = activeGuidanceSession.legacyRoutePlan ?? null;
    const nextAction = legacyPlan ? enrichWithLegacyPlan(baseAction, legacyPlan) : baseAction;
    return makeResult({
      ok: nextAction.status !== 'blocked',
      command: 'next',
      cwd: options.cwd,
      messages: [message('info', nextAction.status === 'blocked' ? 'ATM_GUIDANCE_NEXT_BLOCKED' : 'ATM_GUIDANCE_NEXT_ACTION', 'ATM guidance identified the next single action.', nextAction)],
      evidence: {
        nextAction,
        guidanceSession: {
          sessionId: activeGuidanceSession.sessionId,
          goal: activeGuidanceSession.goal,
          recommendedRoute: activeGuidanceSession.routeDecision.recommendedRoute,
          confidence: activeGuidanceSession.routeDecision.confidence
        }
      }
    });
  }

  const doctor = runDoctor(['--cwd', options.cwd]);
  const runtime = detectGovernanceRuntime(options.cwd, bootstrapTaskId);
  const failed = doctor.evidence.checks.find((check: any) => check.ok !== true);
  const nextAction = decideNextAction(runtime, failed?.name ?? null);
  return makeResult({
    ok: nextAction.status === 'ready',
    command: 'next',
    cwd: options.cwd,
    messages: [nextAction.status === 'ready' ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction) : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction)],
    evidence: {
      nextAction,
      doctorSummary: doctor.evidence.checks.map((check: any) => ({ name: check.name, ok: check.ok })),
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

function enrichWithLegacyPlan(base: GuidanceNextAction, plan: LegacyRoutePlan): GuidanceNextAction {
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

  return {
    ...base,
    status: 'action',
    selectedSegment: preferredSegment.symbolName,
    blockedSegments
  };
}
