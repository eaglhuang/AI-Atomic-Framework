import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type BrokerArbitrationVerdict, evaluateConflictMatrix } from '../../packages/core/src/broker/conflict-matrix.ts';
import { applyOrphanCleanupScan, emptyOrphanCleanupState } from '../../packages/core/src/broker/orphan-cleanup.ts';
import { createManualOverrideAuditEntry } from '../../packages/core/src/broker/recovery.ts';
import type { WriteBrokerRegistryDocument, WriteIntent } from '../../packages/core/src/broker/types.ts';

export type ConflictArbitrationVerdict =
  | 'allow-parallel'
  | 'allow-with-watch'
  | 'freeze'
  | 'steward-takeover'
  | 'deny-and-reroute'
  | 'rollback-required'
  | 'orphan-cleanup-recover';

export interface AgrConflictGroundTruth {
  readonly safeToParallelize: boolean;
  readonly validatorShouldCatch: boolean;
}

export interface AgrConflictExpectation {
  readonly conflictVerdict: ConflictArbitrationVerdict;
  readonly validatorOutcome: 'pass' | 'fail';
}

export interface AgrConflictRegistryCase {
  readonly newIntent: WriteIntent;
  readonly registry: WriteBrokerRegistryDocument;
  readonly readAtoms?: readonly string[];
}

export interface AgrConflictScenario {
  readonly id: string;
  readonly description: string;
  readonly conflictType:
    | 'file-overlap'
    | 'region-overlap'
    | 'read-write-dependency'
    | 'generated-artifact-collision'
    | 'base-drift'
    | 'capsule-cid-drift'
    | 'task-boundary-mismatch'
    | 'orphan-lock'
    | 'manual-override'
    | 'registry-collision';
  readonly registryCase?: AgrConflictRegistryCase;
  readonly sourceCapsuleCid?: string;
  readonly registryCapsuleCid?: string;
  readonly orphanScanNow?: number;
  readonly manualOverride?: {
    readonly actorId: string;
    readonly taskId: string;
    readonly activeLeaseCollision: boolean;
  };
  readonly groundTruth: AgrConflictGroundTruth;
  readonly expected: AgrConflictExpectation;
}

export interface AgrConflictScenarioResult {
  readonly scenarioId: string;
  readonly conflictType: AgrConflictScenario['conflictType'];
  readonly conflictVerdict: ConflictArbitrationVerdict;
  readonly validatorOutcome: 'pass' | 'fail';
  readonly falseSafeRegression: boolean;
  readonly matchedExpectation: boolean;
  readonly latencyNs: number;
}

export interface AgrConflictBenchmarkReport {
  readonly scenarioCount: number;
  readonly falseSafeRegressions: readonly string[];
  readonly expectationFailures: readonly string[];
  readonly catchRate: {
    readonly unsafeScenarioCount: number;
    readonly caughtCount: number;
    readonly missCount: number;
    readonly catchRatePercent: number;
  };
  readonly latency: {
    readonly totalNs: number;
    readonly averageNs: number;
    readonly perScenarioNs: Readonly<Record<string, number>>;
  };
  readonly shipSafe: boolean;
}

const PERMISSIVE_VERDICTS = new Set<ConflictArbitrationVerdict>(['allow-parallel', 'allow-with-watch']);

export function detectCapsuleCidDrift(registryCapsuleCid: string, sourceCapsuleCid: string): boolean {
  return registryCapsuleCid.trim() !== sourceCapsuleCid.trim();
}

export function mapArbitrationVerdictToConflictVerdict(
  arbitrationVerdict: BrokerArbitrationVerdict,
  options: {
    readonly capsuleDrift?: boolean;
    readonly manualOverrideCollision?: boolean;
    readonly orphanRecoverable?: boolean;
  } = {}
): ConflictArbitrationVerdict {
  if (options.orphanRecoverable) {
    return 'orphan-cleanup-recover';
  }
  if (options.manualOverrideCollision) {
    return 'deny-and-reroute';
  }
  if (options.capsuleDrift) {
    return 'freeze';
  }

  switch (arbitrationVerdict) {
    case 'allow':
      return 'allow-parallel';
    case 'watch':
      return 'allow-with-watch';
    case 'freeze':
      return 'freeze';
    case 'takeover':
      return 'steward-takeover';
    default:
      return 'deny-and-reroute';
  }
}

export function evaluateConflictScenario(scenario: AgrConflictScenario): AgrConflictScenarioResult {
  const started = process.hrtime.bigint();
  let conflictVerdict: ConflictArbitrationVerdict = 'deny-and-reroute';
  let validatorOutcome: 'pass' | 'fail' = 'pass';

  if (scenario.conflictType === 'orphan-lock' && scenario.registryCase) {
    const now = scenario.orphanScanNow ?? Date.now();
    const cleanup = applyOrphanCleanupScan(
      scenario.registryCase.registry,
      emptyOrphanCleanupState(),
      { now }
    );
    conflictVerdict = cleanup.result.released.length > 0 ? 'orphan-cleanup-recover' : 'freeze';
    validatorOutcome = cleanup.result.released.length > 0 ? 'pass' : 'fail';
  } else if (scenario.conflictType === 'manual-override' && scenario.manualOverride) {
    const audit = createManualOverrideAuditEntry({
      actorId: scenario.manualOverride.actorId,
      taskId: scenario.manualOverride.taskId,
      overrideKind: 'force-claim',
      reason: 'manual override benchmark scenario',
      previousLeaseEpoch: 1,
      activeLeaseCollision: scenario.manualOverride.activeLeaseCollision
    });
    conflictVerdict = audit.activeLeaseCollision ? 'deny-and-reroute' : 'freeze';
    validatorOutcome = 'pass';
  } else if (scenario.registryCase) {
    const capsuleDrift = scenario.sourceCapsuleCid && scenario.registryCapsuleCid
      ? detectCapsuleCidDrift(scenario.registryCapsuleCid, scenario.sourceCapsuleCid)
      : false;
    const conflictMatrix = evaluateConflictMatrix(
      scenario.registryCase.newIntent,
      scenario.registryCase.registry.activeIntents
    );
    conflictVerdict = mapArbitrationVerdictToConflictVerdict(conflictMatrix.arbitrationVerdict, {
      capsuleDrift,
      manualOverrideCollision: false,
      orphanRecoverable: false
    });

    if (capsuleDrift) {
      conflictVerdict = 'freeze';
    }

    const permissive = PERMISSIVE_VERDICTS.has(conflictVerdict);
    if (!scenario.groundTruth.safeToParallelize && permissive) {
      validatorOutcome = scenario.groundTruth.validatorShouldCatch ? 'fail' : 'pass';
    } else if (scenario.groundTruth.validatorShouldCatch && permissive) {
      validatorOutcome = 'fail';
    } else {
      validatorOutcome = 'pass';
    }
  }

  const latencyNs = Number(process.hrtime.bigint() - started);
  const falseSafeRegression =
    !scenario.groundTruth.safeToParallelize
    && PERMISSIVE_VERDICTS.has(conflictVerdict)
    && scenario.expected.validatorOutcome === 'fail'
    && validatorOutcome === 'pass';
  const matchedExpectation =
    scenario.expected.conflictVerdict === conflictVerdict
    && scenario.expected.validatorOutcome === validatorOutcome;

  return {
    scenarioId: scenario.id,
    conflictType: scenario.conflictType,
    conflictVerdict,
    validatorOutcome,
    falseSafeRegression,
    matchedExpectation,
    latencyNs
  };
}

export function loadAgrConflictBenchmarkManifest(root: string): { readonly scenarios: readonly string[] } {
  const manifestPath = path.join(root, 'scripts/fixtures/agr-conflict-benchmark/manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`missing agr conflict benchmark manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as { readonly scenarios: readonly string[] };
}

export function loadAgrConflictBenchmarkScenario(root: string, scenarioFile: string): AgrConflictScenario {
  const scenarioPath = path.join(root, 'scripts/fixtures/agr-conflict-benchmark', scenarioFile);
  if (!existsSync(scenarioPath)) {
    throw new Error(`missing agr conflict benchmark scenario: ${scenarioPath}`);
  }
  return JSON.parse(readFileSync(scenarioPath, 'utf8')) as AgrConflictScenario;
}

export function loadAllAgrConflictBenchmarkScenarios(root: string): AgrConflictScenario[] {
  const manifest = loadAgrConflictBenchmarkManifest(root);
  return manifest.scenarios.map((scenarioFile) => loadAgrConflictBenchmarkScenario(root, scenarioFile));
}

export function runAgrConflictBenchmarkSuite(root: string): AgrConflictBenchmarkReport {
  const scenarios = loadAllAgrConflictBenchmarkScenarios(root);
  const results = scenarios.map((scenario) => evaluateConflictScenario(scenario));
  const falseSafeRegressions: string[] = [];
  const expectationFailures: string[] = [];
  const perScenarioNs: Record<string, number> = {};
  let totalNs = 0;
  let unsafeScenarioCount = 0;
  let caughtCount = 0;
  let missCount = 0;

  for (const result of results) {
    perScenarioNs[result.scenarioId] = result.latencyNs;
    totalNs += result.latencyNs;
    if (result.falseSafeRegression) {
      falseSafeRegressions.push(result.scenarioId);
    }
    if (!result.matchedExpectation) {
      expectationFailures.push(result.scenarioId);
    }

    const scenario = scenarios.find((entry) => entry.id === result.scenarioId);
    if (!scenario?.groundTruth.safeToParallelize) {
      unsafeScenarioCount += 1;
      if (result.validatorOutcome === 'fail' || !PERMISSIVE_VERDICTS.has(result.conflictVerdict)) {
        caughtCount += 1;
      } else {
        missCount += 1;
      }
    }
  }

  const catchRatePercent = unsafeScenarioCount === 0
    ? 100
    : Math.round((caughtCount / unsafeScenarioCount) * 1000) / 10;

  return {
    scenarioCount: scenarios.length,
    falseSafeRegressions,
    expectationFailures,
    catchRate: {
      unsafeScenarioCount,
      caughtCount,
      missCount,
      catchRatePercent
    },
    latency: {
      totalNs,
      averageNs: scenarios.length === 0 ? 0 : Math.round(totalNs / scenarios.length),
      perScenarioNs
    },
    shipSafe: falseSafeRegressions.length === 0 && expectationFailures.length === 0 && missCount === 0
  };
}

export function listAgrConflictBenchmarkScenarioFiles(root: string): string[] {
  const fixtureDir = path.join(root, 'scripts/fixtures/agr-conflict-benchmark');
  return readdirSync(fixtureDir)
    .filter((name) => name.endsWith('.scenario.json'))
    .sort();
}

export function renderAgrConflictBenchmarkMarkdown(report: AgrConflictBenchmarkReport): string {
  return [
    '# AGR Conflict Arbitration Benchmark',
    '',
    '> Generated by `scripts/validate-agr-conflict-benchmark.ts`.',
    '',
    '## Summary',
    '',
    `- Scenario count: ${report.scenarioCount}`,
    `- Catch rate: ${report.catchRate.catchRatePercent}% (${report.catchRate.caughtCount}/${report.catchRate.unsafeScenarioCount} unsafe scenarios caught)`,
    '- Latency note: runtime latency is measured during each validator run and recorded in receipts/stdout, but omitted from this tracked report because host timing is non-authoritative.',
    `- Ship-safe: ${report.shipSafe ? 'yes' : 'no'}`,
    '',
    '## False-safe regressions',
    '',
    report.falseSafeRegressions.length === 0
      ? '- none'
      : report.falseSafeRegressions.map((entry) => `- ${entry}`).join('\n'),
    '',
    '## Expectation failures',
    '',
    report.expectationFailures.length === 0
      ? '- none'
      : report.expectationFailures.map((entry) => `- ${entry}`).join('\n'),
    '',
    '## Runtime Measurement Policy',
    '',
    '- Validator receipts and stdout carry the current run latency evidence.',
    '- The tracked markdown stays content-stable across equivalent reruns so governance checks do not fail on host-specific timing jitter.'
  ].join('\n');
}
