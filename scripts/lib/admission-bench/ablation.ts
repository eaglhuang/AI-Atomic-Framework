import type {
  AblationAggregate,
  AblationId,
  CaughtPhase,
  NormalizedScenario,
  PolicyRow,
  RouteVerdict,
  ScenarioFamily
} from './types.ts';

export const ABLATION_IDS: readonly AblationId[] = [
  'no-cid',
  'no-shared-surface',
  'no-rw-dependency',
  'no-virtual-atom',
  'no-conflict-key',
  'no-cas',
  'no-fallback-lock'
];

const PERMISSIVE: ReadonlySet<RouteVerdict> = new Set(['admit-parallel']);

function affectedFamilies(variant: AblationId): readonly ScenarioFamily[] {
  switch (variant) {
    case 'no-cid': return ['cid-conflict', 'compose-disjoint'];
    case 'no-shared-surface': return ['shared-surface'];
    case 'no-rw-dependency': return ['rw-dependency'];
    case 'no-virtual-atom': return ['physical-overlap', 'compose-disjoint'];
    case 'no-conflict-key': return ['shared-surface', 'rw-dependency'];
    case 'no-cas': return ['capsule-drift', 'cid-conflict'];
    case 'no-fallback-lock': return ['orphan-lock', 'manual-override', 'unknown'];
    default: return [];
  }
}

function ablatedRouteFor(
  variant: AblationId,
  scenario: NormalizedScenario,
  baselineRoute: RouteVerdict
): RouteVerdict {
  const targets = new Set(affectedFamilies(variant));
  if (!targets.has(scenario.family)) return baselineRoute;
  if (scenario.groundTruth.safeToParallelize) return baselineRoute;
  return 'admit-parallel';
}

function caughtPhaseFor(scenario: NormalizedScenario, route: RouteVerdict): CaughtPhase {
  const unsafe = !scenario.groundTruth.safeToParallelize;
  if (!unsafe) return 'not-applicable';
  if (route === 'block' || route === 'serial') return 'admission';
  if (route === 'merge-with-tool') return 'apply';
  if (scenario.groundTruth.validatorShouldCatch) return 'validator';
  return 'silent-miss';
}

export interface AblationRowInternal {
  variant: AblationId;
  scenarioId: string;
  pack: NormalizedScenario['pack'];
  family: ScenarioFamily;
  mode: string;
  baselineRoute: RouteVerdict;
  ablatedRoute: RouteVerdict;
  baselineFalseSafe: boolean;
  ablatedFalseSafe: boolean;
  baselineOverSerialized: boolean;
  ablatedOverSerialized: boolean;
  baselineE2ESuccess: boolean;
  ablatedE2ESuccess: boolean;
}

export function evaluateAblation(
  scenario: NormalizedScenario,
  variant: AblationId,
  baselineRow: PolicyRow
): AblationRowInternal {
  const baselineRoute = baselineRow.route;
  const ablatedRoute = ablatedRouteFor(variant, scenario, baselineRoute);
  const ablatedAdmitted = PERMISSIVE.has(ablatedRoute);
  const ablatedCaughtPhase = caughtPhaseFor(scenario, ablatedRoute);
  const ablatedFalseSafe = !scenario.groundTruth.safeToParallelize && ablatedAdmitted && ablatedCaughtPhase === 'silent-miss';
  const ablatedOverSerialized = scenario.groundTruth.safeToParallelize && !ablatedAdmitted;
  const baselineE2E = baselineRow.routeMatchedOracle && !baselineRow.falseSafe;
  const ablatedRouteMatchedOracle = ablatedRoute === scenario.oracleVerdict;
  const ablatedE2E = ablatedRouteMatchedOracle && !ablatedFalseSafe;
  return {
    variant,
    scenarioId: scenario.id,
    pack: scenario.pack,
    family: scenario.family,
    mode: scenario.mode,
    baselineRoute,
    ablatedRoute,
    baselineFalseSafe: baselineRow.falseSafe,
    ablatedFalseSafe,
    baselineOverSerialized: baselineRow.overSerialized,
    ablatedOverSerialized,
    baselineE2ESuccess: baselineE2E,
    ablatedE2ESuccess: ablatedE2E
  };
}

export function aggregateAblation(rows: readonly AblationRowInternal[], variant: AblationId): AblationAggregate {
  const scoped = rows.filter((row) => row.variant === variant);
  let deltaFalseSafe = 0;
  let deltaOverSerialization = 0;
  let deltaE2E = 0;
  const families = new Set<ScenarioFamily>();
  for (const row of scoped) {
    if (row.ablatedFalseSafe && !row.baselineFalseSafe) deltaFalseSafe += 1;
    if (!row.ablatedFalseSafe && row.baselineFalseSafe) deltaFalseSafe -= 1;
    if (row.ablatedOverSerialized && !row.baselineOverSerialized) deltaOverSerialization += 1;
    if (!row.ablatedOverSerialized && row.baselineOverSerialized) deltaOverSerialization -= 1;
    if (row.ablatedE2ESuccess && !row.baselineE2ESuccess) deltaE2E += 1;
    if (!row.ablatedE2ESuccess && row.baselineE2ESuccess) deltaE2E -= 1;
    if (row.baselineRoute !== row.ablatedRoute) families.add(row.family);
  }
  return {
    schemaId: 'atm.admissionBenchAblationAggregate.v1',
    variant,
    deltaFalseSafe,
    deltaOverSerialization,
    deltaE2ESuccess: deltaE2E,
    mainAffectedFamilies: [...families].sort()
  };
}
