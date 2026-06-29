import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateConflictMatrix } from '../../packages/core/src/broker/conflict-matrix.ts';
import {
  acknowledgeFreeze,
  createFreezeSignal,
  resolveFreezeDecision
} from '../../packages/core/src/broker/freeze.ts';
import {
  createHandoffPatchEnvelope,
  validatePatchEnvelope
} from '../../packages/core/src/broker/patch-envelope.ts';
import { planStewardApply } from '../../packages/core/src/broker/steward.ts';
import {
  type BrokerArbitrationVerdict,
  type MergePlan,
  type PatchProposal,
  type WriteBrokerRegistryDocument,
  type WriteIntent
} from '../../packages/core/src/broker/types.ts';
import { validateRouteContext, type RouteContext, type RouteContextState } from '../../packages/core/src/routing/route-context.ts';

export type MaoParallelScenarioKind = 'conflict-matrix' | 'route-lifecycle' | 'steward-plan' | 'capsule-drift';

export type MaoCapabilityTask =
  | 'TASK-MAO-0003'
  | 'TASK-MAO-0006'
  | 'TASK-MAO-0007'
  | 'TASK-MAO-0009'
  | 'TASK-MAO-0015'
  | 'TASK-MAO-0046'
  | 'TASK-MAO-0047'
  | 'CID-AGR-INCIDENT';

export type MaoEventReplayKind =
  | 'broker-conflict'
  | 'task-event-claim'
  | 'freeze-protocol'
  | 'patch-envelope-handoff';

export type MaoCoverageTier = 'generic-mao' | 'm5-runner-extension';

export type MaoRoutingVerdict =
  | 'allow-parallel'
  | 'allow-with-watch'
  | 'freeze'
  | 'steward-required'
  | 'blocked'
  | 'route-frozen'
  | 'route-resumed'
  | 'steward-applied'
  | 'steward-blocked';

export interface MaoParallelGroundTruth {
  readonly safeToParallelize: boolean;
  readonly validatorShouldCatch: boolean;
}

export interface MaoParallelExpectation {
  readonly routingVerdict: MaoRoutingVerdict;
  readonly validatorOutcome: 'pass' | 'fail';
}

export interface MaoConflictRegistryCase {
  readonly newIntent: WriteIntent;
  readonly registry: WriteBrokerRegistryDocument;
}

export interface MaoRouteLifecycleCase {
  readonly initialRoute: RouteContext;
  readonly action: 'pause' | 'resume';
  readonly actorId?: string;
  readonly reason?: string;
}

export interface MaoStewardPlanCase {
  readonly stewardId: string;
  readonly mergePlan: MergePlan;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles: readonly string[];
  readonly fileContents: Readonly<Record<string, string>>;
}

export interface MaoParallelRoutingScenario {
  readonly id: string;
  readonly description: string;
  readonly kind: MaoParallelScenarioKind;
  readonly capabilityIntroducedBy: MaoCapabilityTask;
  readonly coverageTier: MaoCoverageTier;
  readonly registryCase?: MaoConflictRegistryCase;
  readonly routeCase?: MaoRouteLifecycleCase;
  readonly stewardCase?: MaoStewardPlanCase;
  readonly sourceCapsuleCid?: string;
  readonly registryCapsuleCid?: string;
  readonly groundTruth: MaoParallelGroundTruth;
  readonly expected: MaoParallelExpectation;
}

export interface MaoEventReplayProvenance {
  readonly origin: 'broker-evidence' | 'task-events';
  readonly sanitizedFrom: string;
  readonly notes: string;
}

export interface MaoFreezeReplayCase {
  readonly taskId: string;
  readonly actorId: string;
  readonly routeId: string;
  readonly fixedNow: number;
  readonly reason: string;
}

export interface MaoPatchEnvelopeReplayCase {
  readonly taskId: string;
  readonly actorId: string;
  readonly freezeId: string;
  readonly targetFiles: readonly string[];
  readonly capturedAt: string;
  readonly partialReason: string;
}

export interface MaoEventReplayScenario {
  readonly id: string;
  readonly description: string;
  readonly layer: 'event-replay';
  readonly replayKind: MaoEventReplayKind;
  readonly capabilityIntroducedBy: MaoCapabilityTask;
  readonly coverageTier: MaoCoverageTier;
  readonly replayProvenance: MaoEventReplayProvenance;
  readonly registryCase?: MaoConflictRegistryCase;
  readonly freezeReplayCase?: MaoFreezeReplayCase;
  readonly patchEnvelopeReplayCase?: MaoPatchEnvelopeReplayCase;
  readonly groundTruth: MaoParallelGroundTruth;
  readonly expected: MaoParallelExpectation;
}

export interface MaoCombinedBenchmarkReport {
  readonly staticReport: MaoParallelBenchmarkReport;
  readonly eventReplayReport: MaoParallelBenchmarkReport;
  readonly combinedShipSafe: boolean;
}

export interface MaoParallelScenarioResult {
  readonly scenarioId: string;
  readonly kind: MaoParallelScenarioKind;
  readonly capabilityIntroducedBy: MaoCapabilityTask;
  readonly coverageTier: MaoCoverageTier;
  readonly routingVerdict: MaoRoutingVerdict;
  readonly validatorOutcome: 'pass' | 'fail';
  readonly falseSafeRegression: boolean;
  readonly matchedExpectation: boolean;
  readonly latencyNs: number;
}

export interface MaoParallelBenchmarkReport {
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
  readonly capabilityCoverage: Readonly<Record<MaoCapabilityTask, number>>;
  readonly tierCoverage: Readonly<Record<MaoCoverageTier, number>>;
  readonly shipSafe: boolean;
}

const PERMISSIVE_VERDICTS = new Set<MaoRoutingVerdict>(['allow-parallel', 'allow-with-watch', 'route-resumed', 'steward-applied']);

function hashText(value: string): string {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

export function mapArbitrationVerdictToMaoRouting(verdict: BrokerArbitrationVerdict): MaoRoutingVerdict {
  switch (verdict) {
    case 'allow':
      return 'allow-parallel';
    case 'watch':
      return 'allow-with-watch';
    case 'freeze':
      return 'freeze';
    case 'takeover':
      return 'steward-required';
    default:
      return 'blocked';
  }
}

export function detectCapsuleCidDrift(registryCapsuleCid: string, sourceCapsuleCid: string): boolean {
  return registryCapsuleCid.trim() !== sourceCapsuleCid.trim();
}

export function transitionMaoRoute(
  route: RouteContext,
  state: RouteContextState,
  options: { readonly actorId?: string; readonly reason?: string } = {}
): RouteContext {
  const now = new Date().toISOString();
  const next: RouteContext = {
    ...route,
    state: state === 'frozen' ? 'frozen' : state === 'open' ? 'open' : route.state,
    updatedAt: now,
    blockedBy: state === 'frozen'
      ? [{ kind: 'steward', id: options.actorId ?? 'route-operator', reason: options.reason ?? 'route paused' }]
      : route.blockedBy,
    admission: state === 'frozen'
      ? { verdict: 'freeze', reason: options.reason ?? 'route paused' }
      : state === 'open'
        ? { verdict: 'watch', reason: options.reason ?? 'route resumed' }
        : route.admission
  };

  const validation = validateRouteContext(next);
  if (!validation.ok) {
    throw new Error(`route transition failed validation: ${validation.errors.join('; ')}`);
  }

  return next;
}

function evaluateConflictRegistryCase(
  registryCase: MaoConflictRegistryCase,
  options: { readonly kind?: MaoParallelScenarioKind; readonly sourceCapsuleCid?: string; readonly registryCapsuleCid?: string } = {}
): MaoRoutingVerdict {
  let routingVerdict = mapArbitrationVerdictToMaoRouting(
    evaluateConflictMatrix(registryCase.newIntent, registryCase.registry.activeIntents).arbitrationVerdict
  );

  if (options.kind === 'capsule-drift' && options.sourceCapsuleCid && options.registryCapsuleCid) {
    if (detectCapsuleCidDrift(options.registryCapsuleCid, options.sourceCapsuleCid)) {
      routingVerdict = 'freeze';
    }
  }

  return routingVerdict;
}

function evaluateConflictMatrixScenario(scenario: MaoParallelRoutingScenario): MaoRoutingVerdict {
  if (!scenario.registryCase) {
    return 'blocked';
  }

  return evaluateConflictRegistryCase(scenario.registryCase, {
    kind: scenario.kind,
    sourceCapsuleCid: scenario.sourceCapsuleCid,
    registryCapsuleCid: scenario.registryCapsuleCid
  });
}

function evaluateFreezeProtocolReplay(scenario: MaoEventReplayScenario): MaoRoutingVerdict {
  if (!scenario.freezeReplayCase) {
    return 'blocked';
  }

  const replay = scenario.freezeReplayCase;
  const signal = createFreezeSignal({
    taskId: replay.taskId,
    actorId: replay.actorId,
    now: replay.fixedNow,
    blockingRoute: replay.routeId,
    conflictingResource: replay.reason
  });
  const ack = acknowledgeFreeze(signal, { now: replay.fixedNow + 1 });
  const resolution = resolveFreezeDecision({
    signal,
    acknowledgedAt: ack.acknowledgedAt,
    now: replay.fixedNow + 2
  });
  return resolution.decision.state === 'acknowledged' ? 'route-frozen' : 'blocked';
}

function evaluatePatchEnvelopeHandoffReplay(scenario: MaoEventReplayScenario): MaoRoutingVerdict {
  if (!scenario.patchEnvelopeReplayCase) {
    return 'blocked';
  }

  const replay = scenario.patchEnvelopeReplayCase;
  const envelope = createHandoffPatchEnvelope({
    taskId: replay.taskId,
    actorId: replay.actorId,
    freezeId: replay.freezeId,
    targetFiles: replay.targetFiles,
    partialReason: replay.partialReason,
    capturedAt: replay.capturedAt
  });
  return validatePatchEnvelope(envelope).ok ? 'freeze' : 'blocked';
}

export function evaluateEventReplayScenario(scenario: MaoEventReplayScenario): MaoParallelScenarioResult {
  const started = process.hrtime.bigint();
  let routingVerdict: MaoRoutingVerdict = 'blocked';

  switch (scenario.replayKind) {
    case 'broker-conflict':
    case 'task-event-claim':
      routingVerdict = scenario.registryCase
        ? evaluateConflictRegistryCase(scenario.registryCase)
        : 'blocked';
      break;
    case 'freeze-protocol':
      routingVerdict = evaluateFreezeProtocolReplay(scenario);
      break;
    case 'patch-envelope-handoff':
      routingVerdict = evaluatePatchEnvelopeHandoffReplay(scenario);
      break;
    default:
      routingVerdict = 'blocked';
  }

  const validatorOutcome = deriveValidatorOutcomeFromGroundTruth(scenario.groundTruth, routingVerdict);
  const falseSafeRegression =
    !scenario.groundTruth.safeToParallelize
    && PERMISSIVE_VERDICTS.has(routingVerdict)
    && scenario.expected.validatorOutcome === 'fail'
    && validatorOutcome === 'pass';
  const matchedExpectation =
    scenario.expected.routingVerdict === routingVerdict
    && scenario.expected.validatorOutcome === validatorOutcome;

  return {
    scenarioId: scenario.id,
    kind: 'conflict-matrix',
    capabilityIntroducedBy: scenario.capabilityIntroducedBy,
    coverageTier: scenario.coverageTier,
    routingVerdict,
    validatorOutcome,
    falseSafeRegression,
    matchedExpectation,
    latencyNs: Number(process.hrtime.bigint() - started)
  };
}

function evaluateRouteLifecycleScenario(scenario: MaoParallelRoutingScenario): MaoRoutingVerdict {
  if (!scenario.routeCase) {
    return 'blocked';
  }

  const { initialRoute, action, actorId, reason } = scenario.routeCase;
  if (action === 'pause') {
    const frozen = transitionMaoRoute(initialRoute, 'frozen', { actorId, reason });
    return frozen.admission?.verdict === 'freeze' && frozen.state === 'frozen' ? 'route-frozen' : 'blocked';
  }

  const paused = transitionMaoRoute(initialRoute, 'frozen', { actorId, reason: reason ?? 'paused for benchmark' });
  const resumed = transitionMaoRoute(paused, 'open', { actorId, reason: reason ?? 'route resumed' });
  return resumed.state === 'open' && resumed.admission?.verdict === 'watch' ? 'route-resumed' : 'blocked';
}

function runGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}

function seedStewardTempRepo(tempDir: string, fileContents: Readonly<Record<string, string>>): string {
  for (const [relativePath, content] of Object.entries(fileContents)) {
    const targetPath = path.join(tempDir, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }

  runGit(tempDir, ['init', '-b', 'main']);
  runGit(tempDir, ['config', 'user.email', 'mao-bench@3klife.local']);
  runGit(tempDir, ['config', 'user.name', 'mao-bench']);
  runGit(tempDir, ['add', '.']);
  runGit(tempDir, ['commit', '-m', 'mao benchmark seed']);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tempDir, encoding: 'utf8' });
  if (head.status !== 0 || !head.stdout.trim()) {
    throw new Error('failed to read steward benchmark temp repo HEAD');
  }
  return head.stdout.trim();
}

function evaluateStewardPlanScenario(scenario: MaoParallelRoutingScenario): MaoRoutingVerdict {
  if (!scenario.stewardCase) {
    return 'blocked';
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'mao-bench-steward-'));
  try {
    const baseCommit = seedStewardTempRepo(tempDir, scenario.stewardCase.fileContents);
    const proposals = scenario.stewardCase.proposals.map((proposal) => {
      const content = scenario.stewardCase!.fileContents[proposal.targetFile];
      if (!content) {
        return { ...proposal, baseCommit };
      }
      return {
        ...proposal,
        baseCommit,
        fileBeforeHash: hashText(content)
      };
    });

    const planResult = planStewardApply({
      cwd: tempDir,
      stewardId: scenario.stewardCase.stewardId,
      mergePlan: scenario.stewardCase.mergePlan,
      proposals,
      scopeFiles: [...scenario.stewardCase.scopeFiles]
    });

    return planResult.ok ? 'steward-applied' : 'steward-blocked';
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function deriveValidatorOutcomeFromGroundTruth(
  groundTruth: MaoParallelGroundTruth,
  routingVerdict: MaoRoutingVerdict
): 'pass' | 'fail' {
  const permissive = PERMISSIVE_VERDICTS.has(routingVerdict);
  if (!groundTruth.safeToParallelize && permissive) {
    return groundTruth.validatorShouldCatch ? 'fail' : 'pass';
  }
  if (groundTruth.validatorShouldCatch && permissive) {
    return 'fail';
  }
  return 'pass';
}

function deriveValidatorOutcome(
  scenario: MaoParallelRoutingScenario,
  routingVerdict: MaoRoutingVerdict
): 'pass' | 'fail' {
  return deriveValidatorOutcomeFromGroundTruth(scenario.groundTruth, routingVerdict);
}

export function evaluateMaoParallelScenario(scenario: MaoParallelRoutingScenario): MaoParallelScenarioResult {
  const started = process.hrtime.bigint();
  let routingVerdict: MaoRoutingVerdict = 'blocked';

  switch (scenario.kind) {
    case 'conflict-matrix':
    case 'capsule-drift':
      routingVerdict = evaluateConflictMatrixScenario(scenario);
      break;
    case 'route-lifecycle':
      routingVerdict = evaluateRouteLifecycleScenario(scenario);
      break;
    case 'steward-plan':
      routingVerdict = evaluateStewardPlanScenario(scenario);
      break;
    default:
      routingVerdict = 'blocked';
  }

  const validatorOutcome = deriveValidatorOutcome(scenario, routingVerdict);
  const falseSafeRegression =
    !scenario.groundTruth.safeToParallelize
    && PERMISSIVE_VERDICTS.has(routingVerdict)
    && scenario.expected.validatorOutcome === 'fail'
    && validatorOutcome === 'pass';
  const matchedExpectation =
    scenario.expected.routingVerdict === routingVerdict
    && scenario.expected.validatorOutcome === validatorOutcome;
  const latencyNs = Number(process.hrtime.bigint() - started);

  return {
    scenarioId: scenario.id,
    kind: scenario.kind,
    capabilityIntroducedBy: scenario.capabilityIntroducedBy,
    coverageTier: scenario.coverageTier,
    routingVerdict,
    validatorOutcome,
    falseSafeRegression,
    matchedExpectation,
    latencyNs
  };
}

export function loadMaoParallelRoutingManifest(root: string): { readonly scenarios: readonly string[] } {
  const manifestPath = path.join(root, 'scripts/fixtures/mao-parallel-routing/manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`missing mao parallel routing benchmark manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as { readonly scenarios: readonly string[] };
}

export function loadMaoParallelRoutingScenario(root: string, scenarioFile: string): MaoParallelRoutingScenario {
  const scenarioPath = path.join(root, 'scripts/fixtures/mao-parallel-routing', scenarioFile);
  if (!existsSync(scenarioPath)) {
    throw new Error(`missing mao parallel routing scenario: ${scenarioPath}`);
  }
  return JSON.parse(readFileSync(scenarioPath, 'utf8')) as MaoParallelRoutingScenario;
}

export function loadAllMaoParallelRoutingScenarios(root: string): MaoParallelRoutingScenario[] {
  const manifest = loadMaoParallelRoutingManifest(root);
  return manifest.scenarios.map((scenarioFile) => loadMaoParallelRoutingScenario(root, scenarioFile));
}

export function loadMaoEventReplayManifest(root: string): { readonly replays: readonly string[] } {
  const manifestPath = path.join(root, 'scripts/fixtures/mao-parallel-routing/event-replay.manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`missing mao event replay benchmark manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as { readonly replays: readonly string[] };
}

export function loadMaoEventReplayScenario(root: string, replayFile: string): MaoEventReplayScenario {
  const replayPath = path.join(root, 'scripts/fixtures/mao-parallel-routing', replayFile);
  if (!existsSync(replayPath)) {
    throw new Error(`missing mao event replay scenario: ${replayPath}`);
  }
  return JSON.parse(readFileSync(replayPath, 'utf8')) as MaoEventReplayScenario;
}

export function loadAllMaoEventReplayScenarios(root: string): MaoEventReplayScenario[] {
  const manifest = loadMaoEventReplayManifest(root);
  return manifest.replays.map((replayFile) => loadMaoEventReplayScenario(root, replayFile));
}

export function listMaoParallelRoutingScenarioFiles(root: string): string[] {
  const fixtureDir = path.join(root, 'scripts/fixtures/mao-parallel-routing');
  return readdirSync(fixtureDir)
    .filter((name) => name.endsWith('.scenario.json'))
    .sort();
}

export function runMaoParallelRoutingBenchmarkSuite(root: string): MaoParallelBenchmarkReport {
  const scenarios = loadAllMaoParallelRoutingScenarios(root);
  const results = scenarios.map((scenario) => evaluateMaoParallelScenario(scenario));
  return buildMaoParallelBenchmarkReport(scenarios.map((scenario) => scenario.id), results, scenarios);
}

export function runMaoEventReplayBenchmarkSuite(root: string): MaoParallelBenchmarkReport {
  const scenarios = loadAllMaoEventReplayScenarios(root);
  const results = scenarios.map((scenario) => evaluateEventReplayScenario(scenario));
  return buildMaoParallelBenchmarkReport(scenarios.map((scenario) => scenario.id), results, scenarios);
}

export function runCombinedMaoBenchmarkSuite(root: string): MaoCombinedBenchmarkReport {
  const staticReport = runMaoParallelRoutingBenchmarkSuite(root);
  const eventReplayReport = runMaoEventReplayBenchmarkSuite(root);
  return {
    staticReport,
    eventReplayReport,
    combinedShipSafe: staticReport.shipSafe && eventReplayReport.shipSafe
  };
}

function buildMaoParallelBenchmarkReport(
  scenarioIds: readonly string[],
  results: readonly MaoParallelScenarioResult[],
  scenarios: readonly Pick<MaoParallelRoutingScenario | MaoEventReplayScenario, 'id' | 'groundTruth'>[]
): MaoParallelBenchmarkReport {
  const falseSafeRegressions: string[] = [];
  const expectationFailures: string[] = [];
  const perScenarioNs: Record<string, number> = {};
  const capabilityCoverage: Record<MaoCapabilityTask, number> = {
    'TASK-MAO-0003': 0,
    'TASK-MAO-0006': 0,
    'TASK-MAO-0007': 0,
    'TASK-MAO-0009': 0,
    'TASK-MAO-0015': 0,
    'TASK-MAO-0046': 0,
    'TASK-MAO-0047': 0,
    'CID-AGR-INCIDENT': 0
  };
  const tierCoverage: Record<MaoCoverageTier, number> = {
    'generic-mao': 0,
    'm5-runner-extension': 0
  };
  let totalNs = 0;
  let unsafeScenarioCount = 0;
  let caughtCount = 0;
  let missCount = 0;

  for (const result of results) {
    perScenarioNs[result.scenarioId] = result.latencyNs;
    totalNs += result.latencyNs;
    capabilityCoverage[result.capabilityIntroducedBy] += 1;
    tierCoverage[result.coverageTier] += 1;

    if (result.falseSafeRegression) {
      falseSafeRegressions.push(result.scenarioId);
    }
    if (!result.matchedExpectation) {
      expectationFailures.push(result.scenarioId);
    }

    const scenario = scenarios.find((entry) => entry.id === result.scenarioId);
    if (!scenario?.groundTruth.safeToParallelize) {
      unsafeScenarioCount += 1;
      if (result.validatorOutcome === 'fail' || !PERMISSIVE_VERDICTS.has(result.routingVerdict)) {
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
    scenarioCount: scenarioIds.length,
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
      averageNs: scenarioIds.length === 0 ? 0 : Math.round(totalNs / scenarioIds.length),
      perScenarioNs
    },
    capabilityCoverage,
    tierCoverage,
    shipSafe: falseSafeRegressions.length === 0 && expectationFailures.length === 0 && missCount === 0
  };
}

export function renderMaoParallelRoutingBenchmarkMarkdown(
  combined: MaoCombinedBenchmarkReport,
  staticScenarios: readonly MaoParallelRoutingScenario[],
  replayScenarios: readonly MaoEventReplayScenario[]
): string {
  const staticRows = staticScenarios.map((scenario) => {
    const result = evaluateMaoParallelScenario(scenario);
    return `| ${scenario.id} | ${scenario.kind} | ${scenario.capabilityIntroducedBy} | ${scenario.coverageTier} | ${result.routingVerdict} | ${result.matchedExpectation ? 'pass' : 'fail'} |`;
  });
  const replayRows = replayScenarios.map((scenario) => {
    const result = evaluateEventReplayScenario(scenario);
    return `| ${scenario.id} | ${scenario.replayKind} | ${scenario.capabilityIntroducedBy} | ${scenario.replayProvenance.origin} | ${result.routingVerdict} | ${result.matchedExpectation ? 'pass' : 'fail'} |`;
  });

  const renderCatchSection = (label: string, report: MaoParallelBenchmarkReport) => [
    `### ${label}`,
    '',
    `- Scenario count: ${report.scenarioCount}`,
    `- Catch rate: ${report.catchRate.catchRatePercent}% (${report.catchRate.caughtCount}/${report.catchRate.unsafeScenarioCount} unsafe scenarios caught)`,
    `- Average latency: ${report.latency.averageNs} ns per scenario`,
    `- Ship-safe: ${report.shipSafe ? 'yes' : 'no'}`
  ].join('\n');

  return [
    '# MAO Parallel Routing Benchmark',
    '',
    '> Generated by `scripts/validate-mao-parallel-routing.ts` for `TASK-MAO-0010` and extended by `TASK-MAO-0048` event replay.',
    '> Deterministic offline simulator. Out of scope: real multi-process load testing and distributed broker consensus (see task card `outOfScope`).',
    '',
    '## Summary',
    '',
    `- Combined ship-safe: ${combined.combinedShipSafe ? 'yes' : 'no'}`,
    renderCatchSection('Static hand-authored scenarios (TASK-MAO-0010)', combined.staticReport),
    renderCatchSection('Event replay scenarios (TASK-MAO-0048)', combined.eventReplayReport),
    '',
    '## How to read event replay coverage',
    '',
    '- Static scenarios prove deterministic logic paths with hand-authored fixtures.',
    '- Event replay scenarios are sanitized snapshots derived from `.atm/history/task-events/` and broker evidence; they do not import private chat transcripts.',
    '- Replay coverage complements static coverage but does not prove all live concurrency cases.',
    '- Freeze and patch-envelope replay cases use fixed timestamps so results stay deterministic in CI.',
    '',
    '## Capability coverage (static scenarios)',
    '',
    ...Object.entries(combined.staticReport.capabilityCoverage)
      .filter(([, count]) => count > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([taskId, count]) => `- ${taskId}: ${count} scenario(s)`),
    '',
    '## Event replay provenance',
    '',
    ...replayScenarios.map((scenario) => `- ${scenario.id}: ${scenario.replayProvenance.origin} ← ${scenario.replayProvenance.sanitizedFrom}`),
    '',
    '## Coverage tiers (static)',
    '',
    `- generic-mao: ${combined.staticReport.tierCoverage['generic-mao']} scenario(s)`,
    `- m5-runner-extension: ${combined.staticReport.tierCoverage['m5-runner-extension']} scenario(s) — expected to grow with MAO-0011+ runner Broker cards`,
    '',
    '## CID / AGR incident lessons retained',
    '',
    '- Same-atom write/write and shared-surface collisions must not false-safe to parallel admission.',
    '- Capsule CID drift and generated-artifact ownership remain freeze/block signals, not watch-only passes.',
    '- Unknown or malformed scope fails closed through steward-required or blocked verdicts.',
    '',
    '## False-safe regressions',
    '',
    ...(combined.staticReport.falseSafeRegressions.length === 0 && combined.eventReplayReport.falseSafeRegressions.length === 0
      ? ['- none']
      : [
        ...combined.staticReport.falseSafeRegressions.map((entry) => `- static:${entry}`),
        ...combined.eventReplayReport.falseSafeRegressions.map((entry) => `- replay:${entry}`)
      ]),
    '',
    '## Expectation failures',
    '',
    ...(combined.staticReport.expectationFailures.length === 0 && combined.eventReplayReport.expectationFailures.length === 0
      ? ['- none']
      : [
        ...combined.staticReport.expectationFailures.map((entry) => `- static:${entry}`),
        ...combined.eventReplayReport.expectationFailures.map((entry) => `- replay:${entry}`)
      ]),
    '',
    '## Static scenario matrix',
    '',
    '| scenario | kind | capability | tier | verdict | matched |',
    '| --- | --- | --- | --- | --- | --- |',
    ...staticRows,
    '',
    '## Event replay matrix',
    '',
    '| scenario | replay kind | capability | source | verdict | matched |',
    '| --- | --- | --- | --- | --- | --- |',
    ...replayRows,
    '',
    '## Per-scenario latency (ns)',
    '',
    '### Static',
    '',
    ...Object.entries(combined.staticReport.latency.perScenarioNs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([scenarioId, latencyNs]) => `- ${scenarioId}: ${latencyNs}`),
    '',
    '### Event replay',
    '',
    ...Object.entries(combined.eventReplayReport.latency.perScenarioNs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([scenarioId, latencyNs]) => `- ${scenarioId}: ${latencyNs}`),
    '',
    '## Remaining risks',
    '',
    '- Harness still simulates route/steward paths locally; live `route` CLI and broker admission integration remain for later waves.',
    '- Event replay fixtures are sanitized snapshots; they do not continuously ingest live `.atm/history` during CI.',
    '- Runner-derived artifact scenarios are placeholders until M5 fixtures land (`TASK-MAO-0011` … `TASK-MAO-0016`).',
    '- Live `route` CLI integration, real-broker admission, and distributed consensus are out of MAO-0010 scope; deferred to MAO-0011+ runner Broker cards and the December 2026 full-paper evaluation.'
  ].join('\n');
}
