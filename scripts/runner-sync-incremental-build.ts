import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
  readonly timings: SealedBuildTimings;
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
    phaseTimingsMs: phaseTimingsRecord(input.timings),
    gitPolicy: {
      rawLogsCommitted: false,
      storage: '.atm/runtime/telemetry/runner-sync-build/**'
    }
  })}\n`, 'utf8');
  return relative.replace(/\\/g, '/');
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
