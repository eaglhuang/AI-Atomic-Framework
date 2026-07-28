import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  RunnerIncrementalBuildPlan,
  RunnerSyncBuildObservation,
  RunnerSyncDominantPhaseSummary,
  TsBuildCacheSummary
} from './runner-sync-incremental-build.ts';
import type { BuildDecision, BuildTarget, SealedBuildTimings } from './run-sealed-runner-build.ts';

type PhaseTimings = {
  readonly inputHashCalculation: number; readonly skipDecision: number;
  readonly worktreeSetup: number; readonly typescriptBuild: number;
  readonly rootDropReleaseAssembly: number; readonly onefileReleaseAssembly: number;
  readonly artifactSync: number; readonly cleanup: number; readonly totalElapsed: number;
};

export function writeRunnerBuildRuntimeTelemetry(input: {
  readonly cwd: string; readonly actorId: string; readonly sealedSourceSha: string;
  readonly buildTarget: BuildTarget; readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision; readonly decisionReason: string;
  readonly incrementalPlan: RunnerIncrementalBuildPlan | null;
  readonly tsBuildCache?: TsBuildCacheSummary | null; readonly timings: SealedBuildTimings;
  readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket'];
  readonly dominantPhaseSummary?: RunnerSyncDominantPhaseSummary;
}): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const taskId = process.env.ATM_TASK_ID?.trim() || 'runner-sync';
  const relative = path.join('.atm', 'runtime', 'telemetry', 'runner-sync-build', `${timestamp}-${taskId}.jsonl`);
  const absolute = path.join(input.cwd, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  appendFileSync(absolute, `${JSON.stringify({
    schemaId: 'atm.runnerSyncBuildRuntimeTelemetry.v1', recordedAt: new Date().toISOString(),
    actorId: input.actorId, sealedSourceSha: input.sealedSourceSha, buildTarget: input.buildTarget,
    buildInputsTreeHash: input.buildInputsTreeHash, buildDecision: input.buildDecision,
    decisionReason: input.decisionReason, changedPathCount: input.incrementalPlan?.changedPaths.length ?? 0,
    affectedPackageCount: input.incrementalPlan?.affectedPackages.length ?? 0,
    affectedGroups: input.incrementalPlan?.affectedGroups ?? null, unsafeReasons: input.incrementalPlan?.unsafeReasons ?? [],
    tsBuildCache: input.tsBuildCache ?? null, phaseTimingsMs: phaseTimingsRecord(input.timings),
    brokerTicket: input.brokerTicket ?? null,
    dominantPhaseSummary: input.dominantPhaseSummary ?? summarizeDominantPhase(input.timings),
    gitPolicy: { rawLogsCommitted: false, storage: '.atm/runtime/telemetry/runner-sync-build/**' }
  })}\n`, 'utf8');
  return relative.replace(/\\/g, '/');
}

export function buildRunnerSyncBuildObservation(input: {
  readonly buildDecision: RunnerSyncBuildObservation['buildDecision']; readonly decisionReason: string;
  readonly incrementalPlan: RunnerIncrementalBuildPlan | null; readonly timings: SealedBuildTimings;
  readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket'];
}): RunnerSyncBuildObservation {
  return { schemaId: 'atm.runnerSyncBuildObservation.v1', buildDecision: input.buildDecision,
    decisionReason: input.decisionReason, brokerTicket: input.brokerTicket ?? null,
    changedPathCount: input.incrementalPlan?.changedPaths.length ?? 0,
    affectedPackageCount: input.incrementalPlan?.affectedPackages.length ?? 0,
    unsafeReasons: input.incrementalPlan?.unsafeReasons ?? [], dominantPhaseSummary: summarizeDominantPhase(input.timings) };
}

export function summarizeDominantPhase(timings: SealedBuildTimings, basis: RunnerSyncDominantPhaseSummary['basis'] = 'single-run'): RunnerSyncDominantPhaseSummary {
  const phases = Object.entries(phaseTimingsRecord(timings)).filter(([phase]) => phase !== 'totalElapsed') as [keyof PhaseTimings, number][];
  const sorted = phases.map(([, value]) => value).sort((left, right) => left - right);
  const dominant = phases.reduce((current, candidate) => candidate[1] > current[1] ? candidate : current, phases[0]);
  const totalElapsedMs = phaseTimingsRecord(timings).totalElapsed;
  return { schemaId: 'atm.runnerSyncDominantPhaseSummary.v1', dominantPhase: dominant[0], dominantPhaseMs: dominant[1], totalElapsedMs,
    dominanceRatio: totalElapsedMs > 0 ? Number((dominant[1] / totalElapsedMs).toFixed(4)) : 0,
    phaseMedianMs: percentile(sorted, 0.5), phaseP95Ms: percentile(sorted, 0.95), measuredPhaseCount: sorted.length,
    optimizationVerdict: basis === 'ab-ba' ? 'improved' : 'inconclusive', basis };
}

export function prepareTsBuildCache(input: { readonly cwd: string; readonly worktreeRoot: string; }): TsBuildCacheSummary {
  const cacheRoot = path.join(input.cwd, '.atm', 'runtime', 'runner-sync-build-cache', 'typescript');
  const cacheFile = path.join(cacheRoot, 'tsconfig.build.tsbuildinfo');
  const worktreeCacheFile = path.join(input.worktreeRoot, '.atm-runtime-cache', 'tsconfig.build.tsbuildinfo');
  mkdirSync(path.dirname(worktreeCacheFile), { recursive: true });
  const existedBefore = existsSync(cacheFile);
  if (existedBefore) cpSync(cacheFile, worktreeCacheFile);
  return { schemaId: 'atm.runnerTsBuildCacheSummary.v1', cacheRoot: '.atm/runtime/runner-sync-build-cache/typescript',
    tsBuildInfoPath: '.atm/runtime/runner-sync-build-cache/typescript/tsconfig.build.tsbuildinfo', existedBefore,
    existsAfter: false, digestBefore: existedBefore ? fileDigest(cacheFile) : null, digestAfter: null,
    restoredBeforeBuild: existedBefore, persistedAfterBuild: false,
    gitPolicy: { rawCacheCommitted: false, storage: '.atm/runtime/runner-sync-build-cache/typescript/**' } };
}

export function persistTsBuildCache(input: { readonly cwd: string; readonly worktreeRoot: string; readonly summary: TsBuildCacheSummary | null; }): TsBuildCacheSummary | null {
  if (!input.summary) return null;
  const cacheRoot = path.join(input.cwd, '.atm', 'runtime', 'runner-sync-build-cache', 'typescript');
  const cacheFile = path.join(cacheRoot, 'tsconfig.build.tsbuildinfo');
  const worktreeCacheFile = path.join(input.worktreeRoot, '.atm-runtime-cache', 'tsconfig.build.tsbuildinfo');
  const existsAfter = existsSync(worktreeCacheFile);
  mkdirSync(cacheRoot, { recursive: true });
  if (existsAfter) cpSync(worktreeCacheFile, cacheFile);
  return { ...input.summary, existsAfter, digestAfter: existsAfter ? fileDigest(worktreeCacheFile) : null, persistedAfterBuild: existsAfter };
}

function phaseTimingsRecord(timings: SealedBuildTimings): PhaseTimings {
  return { inputHashCalculation: timings.inputHashCalculationMs, skipDecision: timings.skipDecisionMs,
    worktreeSetup: timings.worktreeSetupMs, typescriptBuild: timings.typescriptBuildMs,
    rootDropReleaseAssembly: timings.rootDropAssemblyMs, onefileReleaseAssembly: timings.onefileAssemblyMs,
    artifactSync: timings.artifactSyncMs, cleanup: timings.cleanupMs, totalElapsed: timings.totalElapsedMs };
}
function fileDigest(filePath: string): string {
  const stats = statSync(filePath);
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).update(String(stats.mode & 0o777)).digest('hex')}`;
}
function percentile(values: readonly number[], fraction: number): number { if (!values.length) return 0; return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))]; }
