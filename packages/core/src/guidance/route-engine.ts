import type { GuidanceRoute, ProjectOrientationReport, RouteChoice, RouteDecision } from './guidance-packet.ts';
import type { LegacyRoutePlan, LegacyRoutePlanSegment } from './legacy-route-plan.ts';

export interface RouteEngineEvidence {
  readonly existingAtomMatches?: readonly string[];
  readonly demandPoliceFindings?: readonly string[];
  readonly legacyRoutePlan?: LegacyRoutePlan;
  readonly legacyTargetFile?: string | null;
}

export interface RouteEngineInput {
  readonly goal: string;
  readonly orientation: ProjectOrientationReport;
  readonly evidence?: RouteEngineEvidence;
}

export function decideGuidanceRoute(input: RouteEngineInput): RouteDecision {
  const goal = input.goal.trim();
  const lowerGoal = goal.toLowerCase();
  const evidence = input.evidence ?? {};
  const releaseBlockers = input.orientation.releaseBlockers;

  if (input.orientation.adapterStatus.status === 'missing') {
    return buildDecision({
      route: 'adapter-bootstrap',
      confidence: 0.94,
      reasons: ['No ATM config or adapter package was detected, so the host must be bootstrapped before mutation.'],
      requiredEvidence: [],
      blockedBy: [],
      nextCommand: 'node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository" --json'
    });
  }

  if (/docs?|readme|spec|documentation|文件|規格/.test(lowerGoal)) {
    return buildDecision({
      route: 'docs-first',
      confidence: 0.86,
      reasons: ['The goal is documentation/specification oriented, so mutation should start with docs-first evidence.'],
      requiredEvidence: [],
      blockedBy: releaseBlockers,
      nextCommand: 'node atm.mjs guide overview --json'
    });
  }

  if (evidence.legacyRoutePlan) {
    return decideLegacyRoute(input.orientation, evidence.legacyRoutePlan);
  }

  if ((evidence.demandPoliceFindings?.length ?? 0) > 0 || /split|decompos|拆|拆分/.test(lowerGoal)) {
    return buildDecision({
      route: 'split',
      confidence: 0.9,
      reasons: ['Demand/police or split wording points to a split proposal path, not direct file mutation.'],
      requiredEvidence: ['demand-police finding', 'LegacyRoutePlan or equivalent proposal evidence'],
      blockedBy: releaseBlockers,
      nextCommand: 'node atm.mjs upgrade --propose --behavior behavior.split --dry-run --json'
    });
  }

  if ((evidence.existingAtomMatches?.length ?? 0) > 0 || /infect|existing atom|reuse|套用/.test(lowerGoal)) {
    return buildDecision({
      route: 'infect',
      confidence: 0.84,
      reasons: ['Existing atom evidence or reuse wording points to infect proposal flow.'],
      requiredEvidence: ['LegacyRoutePlan or equivalent proposal evidence', 'dry-run proposal'],
      blockedBy: releaseBlockers,
      nextCommand: 'node atm.mjs upgrade --propose --behavior behavior.infect --dry-run --json'
    });
  }

  if (/legacy|extract|atomize|helper|carv|抽出|萃取/.test(lowerGoal) || evidence.legacyTargetFile) {
    return buildDecision({
      route: 'atomize',
      confidence: 0.82,
      reasons: ['Legacy extraction wording points to atomize with a dry-run proposal before host mutation.'],
      requiredEvidence: ['LegacyRoutePlan or equivalent proposal evidence', 'dry-run proposal'],
      blockedBy: releaseBlockers,
      nextCommand: 'node atm.mjs upgrade --propose --behavior behavior.atomize --dry-run --json'
    });
  }

  if (/evolve|upgrade|version|升級|演進/.test(lowerGoal)) {
    return buildDecision({
      route: 'evolve',
      confidence: 0.8,
      reasons: ['Upgrade/evolve wording points to the existing proposal-before-review flow.'],
      requiredEvidence: ['hash-diff report', 'non-regression report', 'quality-comparison report', 'registry-candidate report'],
      blockedBy: releaseBlockers,
      nextCommand: 'node atm.mjs upgrade --propose --dry-run --json'
    });
  }

  return buildDecision({
    route: 'create-atom',
    confidence: 0.72,
    reasons: ['No legacy or upgrade evidence was detected, so a new atom discovery path is the safest default.'],
    requiredEvidence: ['bucket', 'title', 'description', 'logical-name'],
    blockedBy: releaseBlockers,
    nextCommand: 'node atm.mjs guide create-atom --json',
    routeChoices: [
      { route: 'create-atom', reason: 'default for new capability work' },
      { route: 'docs-first', reason: 'choose this if the goal is only specification/documentation' }
    ]
  });
}

function decideLegacyRoute(orientation: ProjectOrientationReport, plan: LegacyRoutePlan): RouteDecision {
  const safeSegments = plan.segments.filter((segment) => plan.safeFirstAtoms.includes(segment.symbolName));
  const preferredSegment = choosePreferredSafeSegment(safeSegments);
  const trunkBlockers = plan.trunkFunctions.filter((symbolName) => plan.releaseBlockers.includes(symbolName));
  const reasons = trunkBlockers.length > 0
    ? [`Legacy route plan marks trunk release blocker(s): ${trunkBlockers.join(', ')}. Direct trunk mutation is blocked; proceed leaf-first.`]
    : ['Legacy route plan is available; proceed with dry-run proposal evidence before mutation.'];

  if (!preferredSegment) {
    return buildDecision({
      route: 'split',
      confidence: 0.78,
      reasons: [...reasons, 'No safe leaf segment is available, so the only next action is split/proposal evidence generation.'],
      requiredEvidence: ['LegacyRoutePlan', 'split proposal evidence', 'human review before apply'],
      blockedBy: orientation.releaseBlockers,
      nextCommand: 'node atm.mjs upgrade --propose --behavior behavior.split --dry-run --json'
    });
  }

  const route = behaviorToRoute(preferredSegment.recommendedBehavior);
  return buildDecision({
    route,
    confidence: route === 'split' ? 0.9 : 0.86,
    reasons: [...reasons, `Selected safe leaf ${preferredSegment.symbolName} for ${preferredSegment.recommendedBehavior} dry-run proposal.`],
    requiredEvidence: ['LegacyRoutePlan', `${preferredSegment.recommendedBehavior} dry-run proposal`, 'human review before apply'],
    blockedBy: orientation.releaseBlockers,
    nextCommand: `node atm.mjs upgrade --propose --behavior behavior.${preferredSegment.recommendedBehavior} --dry-run --json`,
    routeChoices: [{ route, reason: `safe leaf ${preferredSegment.symbolName}` }]
  });
}

function choosePreferredSafeSegment(segments: readonly LegacyRoutePlanSegment[]): LegacyRoutePlanSegment | null {
  return segments.find((segment) => segment.recommendedBehavior === 'split')
    ?? segments.find((segment) => segment.recommendedBehavior === 'infect')
    ?? segments.find((segment) => segment.recommendedBehavior === 'atomize')
    ?? null;
}

function behaviorToRoute(behavior: LegacyRoutePlanSegment['recommendedBehavior']): GuidanceRoute {
  switch (behavior) {
    case 'infect': return 'infect';
    case 'split': return 'split';
    case 'atomize': return 'atomize';
    default: return 'legacy-fix';
  }
}

function buildDecision(input: {
  readonly route: GuidanceRoute;
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly blockedBy: readonly string[];
  readonly nextCommand: string;
  readonly routeChoices?: readonly RouteChoice[];
}): RouteDecision {
  return {
    schemaId: 'atm.guidanceRouteDecision',
    specVersion: '0.1.0',
    recommendedRoute: input.route,
    confidence: input.confidence,
    reasons: input.reasons,
    routeChoices: input.routeChoices ?? [{ route: input.route, reason: input.reasons[0] ?? 'selected by deterministic route engine' }],
    requiredEvidence: input.requiredEvidence,
    blockedBy: input.blockedBy,
    nextCommand: input.nextCommand
  };
}
