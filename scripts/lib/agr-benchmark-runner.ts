import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { composeBrokerProposals } from '../../packages/core/src/broker/compose.ts';
import { calculateBrokerDecision } from '../../packages/core/src/broker/decision.ts';
import type {
  PatchProposal,
  ProposalAtomRef,
  WriteBrokerRegistryDocument,
  WriteIntent
} from '../../packages/core/src/broker/types.ts';

export type AgrBenchmarkMode = 'agrOff' | 'layer1' | 'layer2Adr';

export type ComposeVerdict =
  | 'parallel-safe'
  | 'needs-steward'
  | 'blocked-cid-conflict'
  | 'blocked-shared-surface';

export type RegistryVerdict =
  | 'parallel-safe'
  | 'needs-physical-split'
  | 'blocked-cid-conflict'
  | 'blocked-shared-surface'
  | 'blocked-active-lease'
  | 'serial';

export interface AgrBenchmarkGroundTruth {
  readonly safeToParallelize: boolean;
  readonly validatorShouldCatch: boolean;
}

export interface AgrBenchmarkModeExpectation {
  readonly composeVerdict?: ComposeVerdict;
  readonly brokerVerdict?: RegistryVerdict;
  readonly validatorOutcome: 'pass' | 'fail';
}

export interface AgrBenchmarkRegistryCase {
  readonly newIntent: WriteIntent;
  readonly registry: WriteBrokerRegistryDocument;
  readonly readAtoms?: readonly string[];
}

export interface AgrBenchmarkScenario {
  readonly id: string;
  readonly description: string;
  readonly kind: 'compose' | 'registry';
  readonly relevantModes: readonly AgrBenchmarkMode[];
  readonly proposals?: readonly PatchProposal[];
  readonly registryCase?: AgrBenchmarkRegistryCase;
  readonly layer1Refinement?: Readonly<Record<string, readonly ProposalAtomRef[]>>;
  readonly layer2Refinement?: Readonly<Record<string, readonly ProposalAtomRef[]>>;
  readonly groundTruth: AgrBenchmarkGroundTruth;
  readonly expected: Readonly<Record<AgrBenchmarkMode, AgrBenchmarkModeExpectation>>;
  readonly validatorFixture?: {
    readonly command: string;
    readonly shouldFail: boolean;
  };
}

export interface AgrBenchmarkModeResult {
  readonly mode: AgrBenchmarkMode;
  readonly composeVerdict?: ComposeVerdict;
  readonly brokerVerdict?: RegistryVerdict;
  readonly validatorOutcome: 'pass' | 'fail';
  readonly falseSafeRegression: boolean;
  readonly matchedExpectation: boolean;
}

export interface AgrBenchmarkScenarioResult {
  readonly scenarioId: string;
  readonly modes: readonly AgrBenchmarkModeResult[];
}

export interface AgrBenchmarkReport {
  readonly scenarioCount: number;
  readonly modeComparisons: number;
  readonly falseSafeRegressions: readonly string[];
  readonly expectationFailures: readonly string[];
  readonly catchRate: {
    readonly brokerFalseSafeCount: number;
    readonly validatorCaughtCount: number;
    readonly validatorMissCount: number;
  };
}

const PERMISSIVE_COMPOSE = new Set<ComposeVerdict>(['parallel-safe']);
const PERMISSIVE_REGISTRY = new Set<RegistryVerdict>(['parallel-safe']);

function isPermissiveCompose(verdict: ComposeVerdict | undefined): boolean {
  return verdict !== undefined && PERMISSIVE_COMPOSE.has(verdict);
}

function isPermissiveRegistry(verdict: RegistryVerdict | undefined): boolean {
  return verdict !== undefined && PERMISSIVE_REGISTRY.has(verdict);
}

function applyRefinement(
  proposals: readonly PatchProposal[],
  refinement: Readonly<Record<string, readonly ProposalAtomRef[]>> | undefined
): PatchProposal[] {
  if (!refinement) {
    return [...proposals];
  }

  return proposals.map((proposal) => ({
    ...proposal,
    atomRefs: refinement[proposal.proposalId] ?? proposal.atomRefs
  }));
}

function evaluateComposeMode(
  proposals: readonly PatchProposal[],
  refinement: Readonly<Record<string, readonly ProposalAtomRef[]>> | undefined
): ComposeVerdict {
  const refined = applyRefinement(proposals, refinement);
  const result = composeBrokerProposals(refined);
  return result.mergePlan.verdict;
}

function evaluateRegistryMode(
  registryCase: AgrBenchmarkRegistryCase,
  useAdr: boolean
): RegistryVerdict {
  const base = calculateBrokerDecision(registryCase.newIntent, registryCase.registry);
  if (!useAdr || base.verdict !== 'parallel-safe') {
    return base.verdict;
  }

  const readSet = new Set(registryCase.readAtoms ?? []);
  if (readSet.size === 0) {
    return base.verdict;
  }

  for (const active of registryCase.registry.activeIntents) {
    if (active.taskId === registryCase.newIntent.taskId) {
      continue;
    }

    for (const atomId of active.resourceKeys.atomIds) {
      if (readSet.has(atomId)) {
        return 'serial';
      }
    }

    for (const atomCid of active.resourceKeys.atomCids) {
      if (readSet.has(atomCid)) {
        return 'serial';
      }
    }
  }

  return base.verdict;
}

function resolveValidatorOutcome(scenario: AgrBenchmarkScenario, brokerPermissive: boolean): 'pass' | 'fail' {
  if (!scenario.validatorFixture) {
    return 'pass';
  }

  if (!brokerPermissive) {
    return 'pass';
  }

  return scenario.validatorFixture.shouldFail ? 'fail' : 'pass';
}

function verdictRank(
  composeVerdict: ComposeVerdict | undefined,
  brokerVerdict: RegistryVerdict | undefined
): number {
  const verdict = composeVerdict ?? brokerVerdict;
  switch (verdict) {
    case 'blocked-cid-conflict':
    case 'blocked-shared-surface':
      return 0;
    case 'needs-steward':
    case 'needs-physical-split':
      return 1;
    case 'serial':
      return 2;
    case 'parallel-safe':
      return 3;
    default:
      return -1;
  }
}

function isMorePermissiveThanExpected(
  expectation: AgrBenchmarkModeExpectation,
  composeVerdict: ComposeVerdict | undefined,
  brokerVerdict: RegistryVerdict | undefined
): boolean {
  const expectedRank = verdictRank(expectation.composeVerdict, expectation.brokerVerdict);
  const actualRank = verdictRank(composeVerdict, brokerVerdict);
  return expectedRank >= 0 && actualRank > expectedRank;
}

function detectFalseSafeRegression(
  groundTruth: AgrBenchmarkGroundTruth,
  expectation: AgrBenchmarkModeExpectation,
  composeVerdict: ComposeVerdict | undefined,
  brokerVerdict: RegistryVerdict | undefined,
  validatorOutcome: 'pass' | 'fail'
): boolean {
  if (isMorePermissiveThanExpected(expectation, composeVerdict, brokerVerdict)) {
    return true;
  }

  if (
    groundTruth.validatorShouldCatch &&
    expectation.validatorOutcome === 'fail' &&
    validatorOutcome === 'pass' &&
    (isPermissiveCompose(composeVerdict) || isPermissiveRegistry(brokerVerdict))
  ) {
    return true;
  }

  return false;
}

function compareModeExpectation(
  expectation: AgrBenchmarkModeExpectation,
  composeVerdict: ComposeVerdict | undefined,
  brokerVerdict: RegistryVerdict | undefined,
  validatorOutcome: 'pass' | 'fail'
): boolean {
  if (expectation.composeVerdict !== undefined && expectation.composeVerdict !== composeVerdict) {
    return false;
  }

  if (expectation.brokerVerdict !== undefined && expectation.brokerVerdict !== brokerVerdict) {
    return false;
  }

  if (expectation.validatorOutcome !== undefined && expectation.validatorOutcome !== validatorOutcome) {
    return false;
  }

  return true;
}

export function loadAgrBenchmarkManifest(root: string): { readonly scenarios: readonly string[] } {
  const manifestPath = path.join(root, 'scripts/fixtures/agr-benchmark/manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`missing agr benchmark manifest: ${manifestPath}`);
  }

  return JSON.parse(readFileSync(manifestPath, 'utf8')) as { readonly scenarios: readonly string[] };
}

export function loadAgrBenchmarkScenario(root: string, scenarioFile: string): AgrBenchmarkScenario {
  const scenarioPath = path.join(root, 'scripts/fixtures/agr-benchmark', scenarioFile);
  if (!existsSync(scenarioPath)) {
    throw new Error(`missing agr benchmark scenario: ${scenarioPath}`);
  }

  return JSON.parse(readFileSync(scenarioPath, 'utf8')) as AgrBenchmarkScenario;
}

export function loadAllAgrBenchmarkScenarios(root: string): AgrBenchmarkScenario[] {
  const manifest = loadAgrBenchmarkManifest(root);
  return manifest.scenarios.map((scenarioFile) => loadAgrBenchmarkScenario(root, scenarioFile));
}

export function runAgrBenchmarkScenario(scenario: AgrBenchmarkScenario): AgrBenchmarkScenarioResult {
  const modes: AgrBenchmarkModeResult[] = [];

  for (const mode of scenario.relevantModes) {
    let composeVerdict: ComposeVerdict | undefined;
    let brokerVerdict: RegistryVerdict | undefined;

    if (scenario.kind === 'compose') {
      const proposals = scenario.proposals ?? [];
      if (mode === 'agrOff') {
        composeVerdict = evaluateComposeMode(proposals, undefined);
      } else if (mode === 'layer1') {
        composeVerdict = evaluateComposeMode(proposals, scenario.layer1Refinement);
      } else {
        const layer2 = scenario.layer2Refinement ?? scenario.layer1Refinement;
        composeVerdict = evaluateComposeMode(proposals, layer2);
      }
    } else if (scenario.registryCase) {
      brokerVerdict = evaluateRegistryMode(scenario.registryCase, mode === 'layer2Adr');
    }

    const brokerPermissive = isPermissiveCompose(composeVerdict) || isPermissiveRegistry(brokerVerdict);
    const validatorOutcome = resolveValidatorOutcome(scenario, brokerPermissive);
    const expectation = scenario.expected[mode];
    const falseSafeRegression = detectFalseSafeRegression(
      scenario.groundTruth,
      expectation,
      composeVerdict,
      brokerVerdict,
      validatorOutcome
    );
    const matchedExpectation = compareModeExpectation(expectation, composeVerdict, brokerVerdict, validatorOutcome);

    modes.push({
      mode,
      composeVerdict,
      brokerVerdict,
      validatorOutcome,
      falseSafeRegression,
      matchedExpectation
    });
  }

  return { scenarioId: scenario.id, modes };
}

export function runAgrBenchmarkSuite(root: string): AgrBenchmarkReport {
  const scenarios = loadAllAgrBenchmarkScenarios(root);
  const scenarioResults = scenarios.map((scenario) => runAgrBenchmarkScenario(scenario));

  const falseSafeRegressions: string[] = [];
  const expectationFailures: string[] = [];
  let modeComparisons = 0;
  let brokerFalseSafeCount = 0;
  let validatorCaughtCount = 0;
  let validatorMissCount = 0;

  for (const result of scenarioResults) {
    for (const modeResult of result.modes) {
      modeComparisons += 1;
      if (modeResult.falseSafeRegression) {
        falseSafeRegressions.push(`${result.scenarioId}:${modeResult.mode}`);
      }
      if (!modeResult.matchedExpectation) {
        expectationFailures.push(`${result.scenarioId}:${modeResult.mode}`);
      }

      const brokerPermissive =
        isPermissiveCompose(modeResult.composeVerdict) || isPermissiveRegistry(modeResult.brokerVerdict);
      if (brokerPermissive && modeResult.validatorOutcome === 'fail') {
        brokerFalseSafeCount += 1;
        validatorCaughtCount += 1;
      } else if (brokerPermissive && modeResult.validatorOutcome === 'pass') {
        brokerFalseSafeCount += 1;
        validatorMissCount += 1;
      }
    }
  }

  return {
    scenarioCount: scenarios.length,
    modeComparisons,
    falseSafeRegressions,
    expectationFailures,
    catchRate: {
      brokerFalseSafeCount,
      validatorCaughtCount,
      validatorMissCount
    }
  };
}

export function listAgrBenchmarkScenarioFiles(root: string): string[] {
  const fixtureDir = path.join(root, 'scripts/fixtures/agr-benchmark');
  return readdirSync(fixtureDir)
    .filter((name) => name.endsWith('.scenario.json'))
    .sort();
}
