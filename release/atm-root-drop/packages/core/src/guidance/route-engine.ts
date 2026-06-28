import type { GuidanceRoute, ProjectOrientationReport, RouteChoice, RouteDecision } from './guidance-packet.ts';
import type { LegacyRoutePlan, LegacyRoutePlanSegment } from './legacy-route-plan.ts';

export interface RouteEngineEvidence {
  readonly existingAtomMatches?: readonly string[];
  readonly demandPoliceFindings?: readonly string[];
  readonly legacyRoutePlan?: LegacyRoutePlan;
  readonly legacyTargetFile?: string | null;
  readonly touchedSymbols?: readonly string[];
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
  const evidenceFollowupGoal = (
    /\b(backfill|follow[- ]up|repair record|repair lane|signature)\b/.test(lowerGoal)
    && /\b(evidence|artifact|git-head|review)\b/.test(lowerGoal)
  ) || (
    /\bcross-agent review\b/.test(lowerGoal)
    && /\b(evidence|signature)\b/.test(lowerGoal)
  );

  if (/import task plan|open task cards|load roadmap|task plan import|bulk task import|匯入任務|匯入計畫|匯入路線圖|從計畫.*?開卡|批次開卡|批次匯入任務/.test(lowerGoal)) {
    return buildDecision({
      route: 'task-plan-import',
      confidence: 0.9,
      reasons: ['Goal asks ATM to ingest an external plan into the canonical task store, so the dry-run import flow is the safest next action.'],
      requiredEvidence: ['plan markdown source', 'task import dry-run manifest', 'task import write evidence'],
      blockedBy: releaseBlockers.filter((blocker) => blocker !== 'package-json-missing'),
      nextCommand: 'node atm.mjs tasks import --from <plan.md> --dry-run --json'
    });
  }

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

  if (/rank|prioriti[sz]e|hotspot|messy|cleanup|clean up|candidate|inventory|pipeline|script|source surface|refactor target|資料管線|python 資料管線|資料管線最亂|最亂|最值得先整理|排一下優先順序|優先順序|候選排序|候選盤點|清理候選|重構候選/.test(lowerGoal)) {
    return buildDecision({
      route: 'legacy-candidate-ranking',
      confidence: 0.88,
      reasons: ['The goal asks to inspect or prioritize existing source surfaces, so ATM should rank legacy candidates before choosing split, atomize, or infect.'],
      requiredEvidence: ['source inventory report', 'candidate ranking report', 'police family report'],
      blockedBy: releaseBlockers.filter((blocker) => blocker !== 'package-json-missing'),
      nextCommand: `node atm.mjs candidates rank --include "pipelines/**/*.py" --goal "${quoteCliValue(goal)}" --json`
    });
  }

  if (evidence.legacyRoutePlan) {
    return decideLegacyRoute(input.orientation, evidence.legacyRoutePlan, goal, evidence.touchedSymbols ?? []);
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

  if (evidenceFollowupGoal) {
    return buildDecision({
      route: 'docs-first',
      confidence: 0.84,
      reasons: ['The goal looks like evidence/artifact follow-up work, so ATM should clarify route, scope, and evidence before defaulting to new atom birth.'],
      requiredEvidence: ['current worktree classification', 'intended artifact/evidence command', 'follow-up validator or attestation evidence'],
      blockedBy: releaseBlockers,
      nextCommand: 'node atm.mjs guide overview --json'
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

function decideLegacyRoute(
  orientation: ProjectOrientationReport,
  plan: LegacyRoutePlan,
  goal = '',
  touchedSymbols: readonly string[] = []
): RouteDecision {
  const safeSegments = plan.segments.filter((segment) => plan.safeFirstAtoms.includes(segment.symbolName));
  const preferred = choosePreferredSafeSegment(safeSegments, { goal, touchedSymbols });
  const trunkBlockers = plan.trunkFunctions.filter((symbolName) => plan.releaseBlockers.includes(symbolName));
  const reasons = trunkBlockers.length > 0
    ? [`Legacy route plan marks trunk release blocker(s): ${trunkBlockers.join(', ')}. Direct trunk mutation is blocked; proceed leaf-first.`]
    : ['Legacy route plan is available; proceed with dry-run proposal evidence before mutation.'];

  if (!preferred) {
    return buildDecision({
      route: 'split',
      confidence: 0.78,
      reasons: [...reasons, 'No safe leaf segment is available, so the only next action is split/proposal evidence generation.'],
      requiredEvidence: ['LegacyRoutePlan', 'split proposal evidence', 'human review before apply'],
      blockedBy: orientation.releaseBlockers,
      nextCommand: 'node atm.mjs upgrade --propose --behavior behavior.split --dry-run --json'
    });
  }

  const preferredSegment = preferred.segment;
  const route = behaviorToRoute(preferredSegment.recommendedBehavior);
  const routeChoice = buildRouteChoice(route, preferred);
  return buildDecision({
    route,
    confidence: route === 'split' ? 0.9 : 0.86,
    reasons: [...reasons, routeChoice.reason],
    requiredEvidence: ['LegacyRoutePlan', `${preferredSegment.recommendedBehavior} dry-run proposal`, 'human review before apply'],
    blockedBy: orientation.releaseBlockers,
    nextCommand: `node atm.mjs upgrade --propose --behavior behavior.${preferredSegment.recommendedBehavior} --dry-run --json`,
    routeChoices: [routeChoice]
  });
}

interface RankedSegment {
  readonly segment: LegacyRoutePlanSegment;
  readonly goalAlignment: {
    readonly symbolName: string;
    readonly matchedTerms: readonly string[];
    readonly score: number;
  };
  readonly overrideReason?: string;
}

function choosePreferredSafeSegment(
  segments: readonly LegacyRoutePlanSegment[],
  context: { readonly goal: string; readonly touchedSymbols: readonly string[] }
): RankedSegment | null {
  const ranked = segments.map((segment, index) => rankSegment(segment, context, index));
  ranked.sort((left, right) =>
    right.goalAlignment.score - left.goalAlignment.score
    || behaviorPriority(right.segment.recommendedBehavior) - behaviorPriority(left.segment.recommendedBehavior)
    || left.index - right.index
  );
  const selected = ranked[0];
  if (!selected) {
    return null;
  }
  return {
    segment: selected.segment,
    goalAlignment: selected.goalAlignment,
    overrideReason: selected.overrideReason
  };
}

function rankSegment(
  segment: LegacyRoutePlanSegment,
  context: { readonly goal: string; readonly touchedSymbols: readonly string[] },
  index: number
): RankedSegment & { readonly index: number } {
  const matchedTerms = matchSymbolTerms(context.goal, segment.symbolName);
  const touched = context.touchedSymbols.some((symbolName) => symbolName === segment.symbolName);
  const score = matchedTerms.length > 0 ? 100 : touched ? 75 : 0;
  return {
    segment,
    index,
    goalAlignment: {
      symbolName: segment.symbolName,
      matchedTerms,
      score
    },
    overrideReason: score > 0
      ? `Selected ${segment.symbolName} because it matched the guidance goal or touched-symbol evidence before generic helper fallback.`
      : undefined
  };
}

function matchSymbolTerms(goal: string, symbolName: string): readonly string[] {
  if (!goal.trim()) {
    return [];
  }
  const normalizedGoal = goal.toLowerCase();
  const symbolTerms = Array.from(new Set([
    symbolName,
    symbolName.replace(/_/g, ' '),
    symbolName.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  ].map((term) => term.toLowerCase()).filter(Boolean)));
  return symbolTerms.filter((term) => normalizedGoal.includes(term));
}

function behaviorPriority(behavior: LegacyRoutePlanSegment['recommendedBehavior']): number {
  switch (behavior) {
    case 'split': return 3;
    case 'infect': return 2;
    case 'atomize': return 1;
    default: return 0;
  }
}

function buildRouteChoice(route: GuidanceRoute, ranked: RankedSegment): RouteChoice {
  const baseReason = `Selected safe leaf ${ranked.segment.symbolName} for ${ranked.segment.recommendedBehavior} dry-run proposal.`;
  if (ranked.goalAlignment.score > 0) {
    return {
      route,
      reason: `${baseReason} ${ranked.overrideReason}`,
      goalAlignment: ranked.goalAlignment,
      overrideReason: ranked.overrideReason
    };
  }
  return {
    route,
    reason: `${baseReason} No explicit semantic symbol matched, so ATM used the safe helper fallback order.`,
    goalAlignment: ranked.goalAlignment,
    overrideReason: 'No explicit goal-aligned or touched semantic leaf was available; helper fallback order applied.'
  };
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

function quoteCliValue(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
