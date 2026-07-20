import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { RunnerSyncAdmissionReport } from '../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import type { BuildDecision, BuildTarget, SealedBuildTimings } from './run-sealed-runner-build.ts';

const releaseManifestPaths = [
  path.join('release', 'atm-root-drop', 'release-manifest.json'),
  path.join('release', 'atm-onefile', 'release-manifest.json')
] as const;

const buildInputPaths = [
  'packages',
  'scripts',
  'templates',
  'schemas',
  'atomic_workbench',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json'
] as const;

export type RunnerIncrementalBuildPlan = {
  readonly schemaId: 'atm.runnerIncrementalBuildPlan.v1';
  readonly specVersion: '0.1.0';
  readonly previousSealedSourceSha: string | null;
  readonly currentSealedSourceSha: string;
  readonly changedPaths: readonly string[];
  readonly affectedPackages: readonly string[];
  readonly affectedGroups: {
    readonly packages: readonly string[];
    readonly scripts: readonly string[];
    readonly templates: readonly string[];
    readonly schemas: readonly string[];
    readonly atomicWorkbench: readonly string[];
    readonly rootConfig: readonly string[];
    readonly unknown: readonly string[];
  };
  readonly incrementalEligible: boolean;
  readonly unsafeReasons: readonly string[];
};

export type TsBuildCacheSummary = {
  readonly schemaId: 'atm.runnerTsBuildCacheSummary.v1';
  readonly cacheRoot: string;
  readonly tsBuildInfoPath: string;
  readonly existedBefore: boolean;
  readonly existsAfter: boolean;
  readonly digestBefore: string | null;
  readonly digestAfter: string | null;
  readonly restoredBeforeBuild: boolean;
  readonly persistedAfterBuild: boolean;
  readonly gitPolicy: {
    readonly rawCacheCommitted: false;
    readonly storage: '.atm/runtime/runner-sync-build-cache/typescript/**';
  };
};

export type RunnerSyncDominantPhaseSummary = {
  readonly schemaId: 'atm.runnerSyncDominantPhaseSummary.v1';
  readonly dominantPhase: keyof ReturnType<typeof phaseTimingsRecord>;
  readonly dominantPhaseMs: number;
  readonly totalElapsedMs: number;
  readonly dominanceRatio: number;
  readonly phaseMedianMs: number;
  readonly phaseP95Ms: number;
  readonly measuredPhaseCount: number;
  readonly optimizationVerdict: 'improved' | 'inconclusive';
  readonly basis: 'single-run' | 'ab-ba';
};

export type RunnerSyncBuildObservation = {
  readonly schemaId: 'atm.runnerSyncBuildObservation.v1';
  readonly buildDecision: 'built' | 'cacheHitSkip' | 'incrementalBuild' | 'fullRebuild';
  readonly decisionReason: string;
  readonly brokerTicket: {
    readonly ticketId: string;
    readonly waitedMs: number;
    readonly position: number;
    readonly headOwner: string | null;
  } | null;
  readonly changedPathCount: number;
  readonly affectedPackageCount: number;
  readonly unsafeReasons: readonly string[];
  readonly dominantPhaseSummary: RunnerSyncDominantPhaseSummary;
};

type RunnerSyncPhaseTimings = ReturnType<typeof phaseTimingsRecord>;

export type RunnerSyncReceipt = {
  readonly schemaId: 'atm.runnerSyncReceipt.v1';
  readonly specVersion: '0.1.0';
  readonly taskId: string;
  readonly actorId: string;
  readonly stewardWorkId: string;
  readonly sealedSourceSha: string;
  readonly requestedSurfaces: readonly string[];
  readonly buildTarget: BuildTarget;
  readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision;
  readonly decisionReason: string;
  readonly incrementalPlan: RunnerIncrementalBuildPlan | null;
  readonly runtimeTelemetryRef: string | null;
  readonly tsBuildCache: TsBuildCacheSummary | null;
  readonly brokerTicket: RunnerSyncBuildObservation['brokerTicket'];
  readonly dominantPhaseSummary: RunnerSyncDominantPhaseSummary;
  readonly buildObservation: RunnerSyncBuildObservation;
  readonly phaseTimingsMs: RunnerSyncPhaseTimings;
  readonly treatmentTelemetry: {
    readonly schemaId: 'atm.generatedWriteTreatmentTelemetry.v1';
    readonly executionMode: 'cache-hit-skip' | 'command-executed';
    readonly commandExecuted: boolean;
    readonly outputObserved: boolean;
    readonly receiptValidity: 'valid';
    readonly buildDecision: BuildDecision;
    readonly phaseTimingsMs: RunnerSyncPhaseTimings;
    readonly rawTelemetryPolicy: 'gitignored-runtime-only';
    readonly tsBuildCacheDigest: string | null;
  };
  readonly publishedAt: string;
};

export function planRunnerIncrementalBuild(input: {
  readonly cwd: string;
  readonly currentSealedSourceSha: string;
  readonly previousSealedSourceSha?: string | null;
}): RunnerIncrementalBuildPlan {
  const previousSealedSourceSha = input.previousSealedSourceSha ?? readPreviousSealedSourceSha(input.cwd);
  const changedPaths = previousSealedSourceSha
    ? readChangedBuildInputPaths(input.cwd, previousSealedSourceSha, input.currentSealedSourceSha)
    : [];
  const affectedGroups = {
    packages: [] as string[],
    scripts: [] as string[],
    templates: [] as string[],
    schemas: [] as string[],
    atomicWorkbench: [] as string[],
    rootConfig: [] as string[],
    unknown: [] as string[]
  };
  const affectedPackages = new Set<string>();
  const unsafeReasons = new Set<string>();
  for (const relativePath of changedPaths) {
    const normalized = relativePath.replace(/\\/g, '/');
    const packageMatch = normalized.match(/^packages\/([^/]+)\//);
    if (packageMatch) {
      const packageDir = `packages/${packageMatch[1]}`;
      affectedGroups.packages.push(normalized);
      affectedPackages.add(packageDir);
    } else if (normalized.startsWith('scripts/')) {
      affectedGroups.scripts.push(normalized);
      unsafeReasons.add('build-script-change');
    } else if (normalized.startsWith('templates/')) {
      affectedGroups.templates.push(normalized);
    } else if (normalized.startsWith('schemas/')) {
      affectedGroups.schemas.push(normalized);
    } else if (normalized.startsWith('atomic_workbench/')) {
      affectedGroups.atomicWorkbench.push(normalized);
    } else if (['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'].includes(normalized)) {
      affectedGroups.rootConfig.push(normalized);
      unsafeReasons.add('root-config-change');
    } else {
      affectedGroups.unknown.push(normalized);
      unsafeReasons.add('unknown-build-input');
    }
  }
  if (!previousSealedSourceSha) unsafeReasons.add('missing-previous-sealed-source');
  return {
    schemaId: 'atm.runnerIncrementalBuildPlan.v1',
    specVersion: '0.1.0',
    previousSealedSourceSha,
    currentSealedSourceSha: input.currentSealedSourceSha,
    changedPaths,
    affectedPackages: [...affectedPackages].sort(),
    affectedGroups: {
      packages: affectedGroups.packages.sort(),
      scripts: affectedGroups.scripts.sort(),
      templates: affectedGroups.templates.sort(),
      schemas: affectedGroups.schemas.sort(),
      atomicWorkbench: affectedGroups.atomicWorkbench.sort(),
      rootConfig: affectedGroups.rootConfig.sort(),
      unknown: affectedGroups.unknown.sort()
    },
    incrementalEligible: changedPaths.length > 0 && affectedPackages.size > 0 && unsafeReasons.size === 0,
    unsafeReasons: [...unsafeReasons].sort()
  };
}

export function writeRunnerBuildRuntimeTelemetry(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly sealedSourceSha: string;
  readonly buildTarget: BuildTarget;
  readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision;
  readonly decisionReason: string;
  readonly incrementalPlan: RunnerIncrementalBuildPlan | null;
  readonly tsBuildCache?: TsBuildCacheSummary | null;
  readonly timings: SealedBuildTimings;
  readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket'];
  readonly dominantPhaseSummary?: RunnerSyncDominantPhaseSummary;
}): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const taskId = process.env.ATM_TASK_ID?.trim() || 'runner-sync';
  const relative = path.join('.atm', 'runtime', 'telemetry', 'runner-sync-build', `${timestamp}-${taskId}.jsonl`);
  const absolute = path.join(input.cwd, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  appendFileSync(absolute, `${JSON.stringify({
    schemaId: 'atm.runnerSyncBuildRuntimeTelemetry.v1',
    recordedAt: new Date().toISOString(),
    actorId: input.actorId,
    sealedSourceSha: input.sealedSourceSha,
    buildTarget: input.buildTarget,
    buildInputsTreeHash: input.buildInputsTreeHash,
    buildDecision: input.buildDecision,
    decisionReason: input.decisionReason,
    changedPathCount: input.incrementalPlan?.changedPaths.length ?? 0,
    affectedPackageCount: input.incrementalPlan?.affectedPackages.length ?? 0,
    affectedGroups: input.incrementalPlan?.affectedGroups ?? null,
    unsafeReasons: input.incrementalPlan?.unsafeReasons ?? [],
    tsBuildCache: input.tsBuildCache ?? null,
    phaseTimingsMs: phaseTimingsRecord(input.timings),
    brokerTicket: input.brokerTicket ?? null,
    dominantPhaseSummary: input.dominantPhaseSummary ?? summarizeDominantPhase(input.timings),
    gitPolicy: {
      rawLogsCommitted: false,
      storage: '.atm/runtime/telemetry/runner-sync-build/**'
    }
  })}\n`, 'utf8');
  return relative.replace(/\\/g, '/');
}

export function buildRunnerSyncBuildObservation(input: {
  readonly buildDecision: RunnerSyncBuildObservation['buildDecision'];
  readonly decisionReason: string;
  readonly incrementalPlan: RunnerIncrementalBuildPlan | null;
  readonly timings: SealedBuildTimings;
  readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket'];
}): RunnerSyncBuildObservation {
  return {
    schemaId: 'atm.runnerSyncBuildObservation.v1',
    buildDecision: input.buildDecision,
    decisionReason: input.decisionReason,
    brokerTicket: input.brokerTicket ?? null,
    changedPathCount: input.incrementalPlan?.changedPaths.length ?? 0,
    affectedPackageCount: input.incrementalPlan?.affectedPackages.length ?? 0,
    unsafeReasons: input.incrementalPlan?.unsafeReasons ?? [],
    dominantPhaseSummary: summarizeDominantPhase(input.timings)
  };
}

export function summarizeDominantPhase(
  timings: SealedBuildTimings,
  basis: RunnerSyncDominantPhaseSummary['basis'] = 'single-run'
): RunnerSyncDominantPhaseSummary {
  const phases = Object.entries(phaseTimingsRecord(timings))
    .filter(([phase]) => phase !== 'totalElapsed') as [keyof ReturnType<typeof phaseTimingsRecord>, number][];
  const sorted = phases.map(([, value]) => value).sort((left, right) => left - right);
  const dominant = phases.reduce((current, candidate) => candidate[1] > current[1] ? candidate : current, phases[0]);
  const totalElapsedMs = phaseTimingsRecord(timings).totalElapsed;
  return {
    schemaId: 'atm.runnerSyncDominantPhaseSummary.v1',
    dominantPhase: dominant[0],
    dominantPhaseMs: dominant[1],
    totalElapsedMs,
    dominanceRatio: totalElapsedMs > 0 ? Number((dominant[1] / totalElapsedMs).toFixed(4)) : 0,
    phaseMedianMs: percentile(sorted, 0.5),
    phaseP95Ms: percentile(sorted, 0.95),
    measuredPhaseCount: sorted.length,
    optimizationVerdict: basis === 'ab-ba' ? 'improved' : 'inconclusive',
    basis
  };
}

export function writeJsonWithRetry(input: {
  readonly filePath: string;
  readonly value: unknown;
  readonly retries?: number;
}): void {
  const retries = input.retries ?? 3;
  const payload = `${JSON.stringify(input.value, null, 2)}\n`;
  const tempPath = `${input.filePath}.tmp-${process.pid}-${Date.now()}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      writeFileSync(tempPath, payload, 'utf8');
      renameSync(tempPath, input.filePath);
      return;
    } catch (error) {
      lastError = error;
      try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch {}
    }
  }
  throw lastError;
}

export function buildRunnerSyncReceipt(input: {
  readonly admission: RunnerSyncAdmissionReport;
  readonly actorId: string;
  readonly sealedSourceSha: string;
  readonly buildTarget: BuildTarget;
  readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision;
  readonly decisionReason?: string;
  readonly incrementalPlan?: RunnerIncrementalBuildPlan | null;
  readonly runtimeTelemetryRef?: string | null;
  readonly tsBuildCache?: TsBuildCacheSummary | null;
  readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket'];
  readonly dominantPhaseSummary?: RunnerSyncDominantPhaseSummary;
  readonly timings: SealedBuildTimings;
  readonly publishedAt?: string;
}): RunnerSyncReceipt {
  const taskId = input.admission.queueHeadOwnership.waitingTasks[0] ?? '';
  const stewardWorkId = input.admission.queueHeadOwnership.stewardWorkId ?? '';
  if (!taskId || !stewardWorkId) {
    throw new Error('ATM_RUNNER_SYNC_RECEIPT_INVALID: queue-head task and steward work id are required to publish a runner-sync receipt.');
  }
  const brokerTicket = input.brokerTicket ?? normalizeBrokerTicket(input.admission);
  return {
    schemaId: 'atm.runnerSyncReceipt.v1',
    specVersion: '0.1.0',
    taskId,
    actorId: input.actorId,
    stewardWorkId,
    sealedSourceSha: input.sealedSourceSha,
    requestedSurfaces: [...input.admission.runnerSyncSteward?.requestedSurfaces ?? []].sort(),
    buildTarget: input.buildTarget,
    buildInputsTreeHash: input.buildInputsTreeHash,
    buildDecision: input.buildDecision,
    decisionReason: input.decisionReason ?? '',
    incrementalPlan: input.incrementalPlan ?? null,
    runtimeTelemetryRef: input.runtimeTelemetryRef ?? null,
    tsBuildCache: input.tsBuildCache ?? null,
    brokerTicket,
    dominantPhaseSummary: input.dominantPhaseSummary ?? summarizeDominantPhase(input.timings),
    buildObservation: buildRunnerSyncBuildObservation({
      buildDecision: input.buildDecision,
      decisionReason: input.decisionReason ?? '',
      incrementalPlan: input.incrementalPlan ?? null,
      timings: input.timings,
      brokerTicket
    }),
    phaseTimingsMs: phaseTimingsRecord(input.timings),
    treatmentTelemetry: {
      schemaId: 'atm.generatedWriteTreatmentTelemetry.v1',
      executionMode: input.buildDecision === 'cacheHitSkip' ? 'cache-hit-skip' : 'command-executed',
      commandExecuted: input.buildDecision !== 'cacheHitSkip',
      outputObserved: true,
      receiptValidity: 'valid',
      buildDecision: input.buildDecision,
      phaseTimingsMs: phaseTimingsRecord(input.timings),
      rawTelemetryPolicy: 'gitignored-runtime-only',
      tsBuildCacheDigest: input.tsBuildCache ? digestJson(input.tsBuildCache) : null
    },
    publishedAt: input.publishedAt ?? new Date().toISOString()
  };
}

export function writeRunnerSyncReceipt(input: {
  readonly cwd: string;
  readonly admission: RunnerSyncAdmissionReport;
  readonly actorId: string;
  readonly sealedSourceSha: string;
  readonly buildTarget: BuildTarget;
  readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision;
  readonly decisionReason?: string;
  readonly incrementalPlan?: RunnerIncrementalBuildPlan | null;
  readonly runtimeTelemetryRef?: string | null;
  readonly tsBuildCache?: TsBuildCacheSummary | null;
  readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket'];
  readonly dominantPhaseSummary?: RunnerSyncDominantPhaseSummary;
  readonly timings: SealedBuildTimings;
}): string {
  const receipt = buildRunnerSyncReceipt(input);
  const relative = path.join('.atm', 'history', 'evidence', `${receipt.taskId}.runner-sync-receipt.json`);
  const absolute = path.join(input.cwd, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeJsonWithRetry({ filePath: absolute, value: receipt });
  return relative.replace(/\\/g, '/');
}

export function prepareTsBuildCache(input: {
  readonly cwd: string;
  readonly worktreeRoot: string;
}): TsBuildCacheSummary {
  const cacheRoot = path.join(input.cwd, '.atm', 'runtime', 'runner-sync-build-cache', 'typescript');
  const cacheFile = path.join(cacheRoot, 'tsconfig.build.tsbuildinfo');
  const worktreeCacheFile = path.join(input.worktreeRoot, '.atm-runtime-cache', 'tsconfig.build.tsbuildinfo');
  mkdirSync(path.dirname(worktreeCacheFile), { recursive: true });
  const existedBefore = existsSync(cacheFile);
  const digestBefore = existedBefore ? fileDigest(cacheFile) : null;
  let restoredBeforeBuild = false;
  if (existedBefore) {
    cpSync(cacheFile, worktreeCacheFile);
    restoredBeforeBuild = true;
  }
  return {
    schemaId: 'atm.runnerTsBuildCacheSummary.v1',
    cacheRoot: '.atm/runtime/runner-sync-build-cache/typescript',
    tsBuildInfoPath: '.atm/runtime/runner-sync-build-cache/typescript/tsconfig.build.tsbuildinfo',
    existedBefore,
    existsAfter: false,
    digestBefore,
    digestAfter: null,
    restoredBeforeBuild,
    persistedAfterBuild: false,
    gitPolicy: {
      rawCacheCommitted: false,
      storage: '.atm/runtime/runner-sync-build-cache/typescript/**'
    }
  };
}

export function persistTsBuildCache(input: {
  readonly cwd: string;
  readonly worktreeRoot: string;
  readonly summary: TsBuildCacheSummary | null;
}): TsBuildCacheSummary | null {
  if (!input.summary) return null;
  const cacheRoot = path.join(input.cwd, '.atm', 'runtime', 'runner-sync-build-cache', 'typescript');
  const cacheFile = path.join(cacheRoot, 'tsconfig.build.tsbuildinfo');
  const worktreeCacheFile = path.join(input.worktreeRoot, '.atm-runtime-cache', 'tsconfig.build.tsbuildinfo');
  const existsAfter = existsSync(worktreeCacheFile);
  mkdirSync(cacheRoot, { recursive: true });
  if (existsAfter) cpSync(worktreeCacheFile, cacheFile);
  return {
    ...input.summary,
    existsAfter,
    digestAfter: existsAfter ? fileDigest(worktreeCacheFile) : null,
    persistedAfterBuild: existsAfter
  };
}

export function syncDirectoryHashChanged(source: string, target: string): void {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  const expected = new Set<string>();
  for (const sourceFile of walkFiles(source)) {
    const relative = path.relative(source, sourceFile);
    expected.add(relative.replace(/\\/g, '/'));
    const targetFile = path.join(target, relative);
    mkdirSync(path.dirname(targetFile), { recursive: true });
    if (existsSync(targetFile) && fileDigest(targetFile) === fileDigest(sourceFile)) continue;
    cpSync(sourceFile, targetFile);
  }
  for (const targetFile of walkFiles(target)) {
    const relative = path.relative(target, targetFile).replace(/\\/g, '/');
    if (!expected.has(relative)) unlinkSync(targetFile);
  }
}

export function phaseTimingsRecord(timings: SealedBuildTimings): {
  readonly inputHashCalculation: number;
  readonly skipDecision: number;
  readonly worktreeSetup: number;
  readonly typescriptBuild: number;
  readonly rootDropReleaseAssembly: number;
  readonly onefileReleaseAssembly: number;
  readonly artifactSync: number;
  readonly cleanup: number;
  readonly totalElapsed: number;
} {
  return {
    inputHashCalculation: timings.inputHashCalculationMs,
    skipDecision: timings.skipDecisionMs,
    worktreeSetup: timings.worktreeSetupMs,
    typescriptBuild: timings.typescriptBuildMs,
    rootDropReleaseAssembly: timings.rootDropAssemblyMs,
    onefileReleaseAssembly: timings.onefileAssemblyMs,
    artifactSync: timings.artifactSyncMs,
    cleanup: timings.cleanupMs,
    totalElapsed: timings.totalElapsedMs
  };
}

export function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function readPreviousSealedSourceSha(cwd: string): string | null {
  for (const relative of releaseManifestPaths) {
    const absolute = path.join(cwd, relative);
    if (!existsSync(absolute)) continue;
    const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
    const value = typeof parsed.sealedSourceCommit === 'string' ? parsed.sealedSourceCommit.trim() : '';
    if (value) return value;
  }
  return null;
}

function readChangedBuildInputPaths(cwd: string, previous: string, current: string): readonly string[] {
  const result = spawnSync('git', ['diff', '--name-only', `${previous}..${current}`, '--', ...buildInputPaths], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((result.status ?? 1) !== 0 || result.error) return [];
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean).sort();
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

function fileDigest(filePath: string): string {
  const stats = statSync(filePath);
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).update(String(stats.mode & 0o777)).digest('hex')}`;
}

function normalizeBrokerTicket(admission: RunnerSyncAdmissionReport): RunnerSyncBuildObservation['brokerTicket'] {
  const ticket = admission.brokerTicket;
  if (!ticket) return null;
  return {
    ticketId: ticket.ticketId,
    waitedMs: ticket.waitedMs,
    position: ticket.position,
    headOwner: ticket.headOwner
  };
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * fraction) - 1));
  return sortedValues[index];
}
