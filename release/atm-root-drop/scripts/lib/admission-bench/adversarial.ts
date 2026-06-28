import type {
  AdversarialFaultId,
  AdversarialRow,
  NormalizedScenario,
  RouteVerdict
} from './types.ts';
import { evaluatePolicy, oracleVerdictFromScenario } from './policies.ts';

export const ADVERSARIAL_FAULTS: readonly AdversarialFaultId[] = [
  'dropped-read-set',
  'dropped-write-surface',
  'wrong-conflict-key',
  'shrunk-range',
  'all-conflict-dos'
];

const PERMISSIVE: ReadonlySet<RouteVerdict> = new Set(['admit-parallel']);

function applyFault(scenario: NormalizedScenario, fault: AdversarialFaultId): NormalizedScenario {
  switch (fault) {
    case 'dropped-read-set':
    case 'dropped-write-surface':
    case 'wrong-conflict-key':
    case 'shrunk-range':
      return { ...scenario, oracleVerdict: 'admit-parallel' };
    case 'all-conflict-dos':
      return { ...scenario, oracleVerdict: 'block' };
    default:
      return scenario;
  }
}

function classify(
  scenario: NormalizedScenario,
  baselineRoute: RouteVerdict,
  faultedRoute: RouteVerdict,
  fault: AdversarialFaultId
): AdversarialRow['faultClassifiedAs'] {
  const unsafe = !scenario.groundTruth.safeToParallelize;
  const baselineCaught = unsafe && !PERMISSIVE.has(baselineRoute);
  const faultedCaught = unsafe && !PERMISSIVE.has(faultedRoute);
  if (fault === 'all-conflict-dos') {
    if (scenario.groundTruth.safeToParallelize && faultedRoute === 'block') return 'over-conservative';
    if (baselineCaught && faultedCaught) return 'enforcement-held';
    return 'oracle-degraded';
  }
  if (!unsafe) return 'oracle-degraded';
  if (baselineCaught && !faultedCaught) return 'silent-miss';
  if (baselineCaught && faultedCaught) return 'enforcement-held';
  if (!baselineCaught && faultedCaught) return 'over-conservative';
  return 'oracle-degraded';
}

export function evaluateAdversarial(scenario: NormalizedScenario, fault: AdversarialFaultId): AdversarialRow {
  const baselineRoute = oracleVerdictFromScenario(scenario);
  const faulted = applyFault(scenario, fault);
  const faultedRow = evaluatePolicy(faulted, 'atm-full');
  const unsafe = !scenario.groundTruth.safeToParallelize;
  const atmFullCaughtBaseline = unsafe && !PERMISSIVE.has(baselineRoute);
  const atmFullCaughtUnderFault = unsafe && !PERMISSIVE.has(faultedRow.route);
  return {
    schemaId: 'atm.admissionBenchAdversarialRow.v1',
    fault,
    scenarioId: scenario.id,
    pack: scenario.pack,
    family: scenario.family,
    mode: scenario.mode,
    atmFullCaughtBaseline,
    atmFullCaughtUnderFault,
    faultClassifiedAs: classify(scenario, baselineRoute, faultedRow.route, fault)
  };
}
