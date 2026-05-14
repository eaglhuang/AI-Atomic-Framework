import type { GuidanceRoute, ProjectOrientationReport, RouteChoice, RouteDecision } from './guidance-packet.ts';

export interface RouteEngineEvidence {
  readonly existingAtomMatches?: readonly string[];
  readonly demandPoliceFindings?: readonly string[];
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
