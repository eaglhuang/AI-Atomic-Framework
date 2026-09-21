import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { RunnerSyncAdmissionReport } from '../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import { buildRunnerSyncReleaseCommand, digestJson, syncDirectoryHashChanged, writeJsonWithRetry, type RunnerIncrementalBuildPlan, type RunnerSyncBuildObservation, type RunnerSyncDominantPhaseSummary, type TsBuildCacheSummary } from './runner-sync-incremental-build.ts';
import type { BuildDecision, BuildTarget, SealedBuildTimings } from './run-sealed-runner-build.ts';

const releaseManifestPaths = [path.join('release', 'atm-root-drop', 'release-manifest.json'), path.join('release', 'atm-onefile', 'release-manifest.json')] as const;

/** Cohesive artifact lifecycle: copy, provenance metadata, and steward release. */
export function syncSealedBuildArtifacts(sourceRoot: string, targetRoot: string, buildTarget: BuildTarget, preservePaths: readonly string[] = []): { readonly preservedPaths: readonly string[] } {
  const preservedUnder = (root: string) => preservePaths.filter((entry) => entry === root || entry.startsWith(`${root}/`)).map((entry) => entry.slice(root.length).replace(/^\//, ''));
  if (buildTarget === 'full' || buildTarget === 'packages') for (const packageName of readDirectoryNames(path.join(sourceRoot, 'packages'))) { const root = `packages/${packageName}/dist`; syncDirectoryHashChanged(path.join(sourceRoot, root), path.join(targetRoot, root), { preserveRelativePaths: preservedUnder(root) }); }
  if (buildTarget === 'full' || buildTarget === 'root-drop') syncDirectoryHashChanged(path.join(sourceRoot, 'release', 'atm-root-drop'), path.join(targetRoot, 'release', 'atm-root-drop'), { preserveRelativePaths: preservedUnder('release/atm-root-drop') });
  if (buildTarget === 'full' || buildTarget === 'onefile') syncDirectoryHashChanged(path.join(sourceRoot, 'release', 'atm-onefile'), path.join(targetRoot, 'release', 'atm-onefile'), { preserveRelativePaths: preservedUnder('release/atm-onefile') });
  return { preservedPaths: [...preservePaths].sort((left, right) => left.localeCompare(right)) };
}

export function hydrateSealedPackageDist(input: { readonly cwd: string; readonly worktreeRoot: string; readonly removeTree: (targetPath: string) => void; }): void {
  const sourcePackages = path.join(input.cwd, 'release', 'atm-root-drop', 'packages'); const targetPackages = path.join(input.worktreeRoot, 'packages');
  if (!existsSync(sourcePackages) || !existsSync(targetPackages)) return;
  for (const packageName of readDirectoryNames(sourcePackages)) { const source = path.join(sourcePackages, packageName, 'dist'); const target = path.join(targetPackages, packageName, 'dist'); if (!existsSync(source) || !existsSync(path.dirname(target))) continue; input.removeTree(target); cpSync(source, target, { recursive: true }); }
}

export function writeSealedBuildMetadata(input: { readonly cwd: string; readonly sealedSourceSha: string; readonly buildInputsTreeHash: string; readonly buildDecision: BuildDecision; readonly decisionReason?: string; readonly incrementalPlan?: RunnerIncrementalBuildPlan | null; readonly runtimeTelemetryRef?: string | null; readonly tsBuildCache?: TsBuildCacheSummary | null; readonly brokerTicket?: RunnerSyncBuildObservation['brokerTicket']; readonly dominantPhaseSummary?: RunnerSyncDominantPhaseSummary; readonly timings: SealedBuildTimings; readonly preservePaths?: readonly string[]; }): void {
  const preserved = new Set(input.preservePaths ?? []);
  for (const relative of releaseManifestPaths) { if (preserved.has(relative.replace(/\\/g, '/'))) continue; const absolute = path.join(input.cwd, relative); if (!existsSync(absolute)) continue; const manifest = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>; Object.assign(manifest, { buildInputsTreeHash: input.buildInputsTreeHash, sealedSourceCommit: input.sealedSourceSha, buildDecision: input.buildDecision, buildDecisionReason: input.decisionReason ?? null, incrementalPlanDigest: input.incrementalPlan ? digestJson(input.incrementalPlan) : null, tsBuildCacheDigest: input.tsBuildCache ? digestJson(input.tsBuildCache) : null, rawTelemetryPolicy: 'gitignored-runtime-only', dominantPhaseSummary: input.dominantPhaseSummary, phaseTimingsMs: { inputHashCalculation: input.timings.inputHashCalculationMs, skipDecision: input.timings.skipDecisionMs, worktreeSetup: input.timings.worktreeSetupMs, typescriptBuild: input.timings.typescriptBuildMs, rootDropReleaseAssembly: input.timings.rootDropAssemblyMs, onefileReleaseAssembly: input.timings.onefileAssemblyMs, artifactSync: input.timings.artifactSyncMs, cleanup: input.timings.cleanupMs, totalElapsed: input.timings.totalElapsedMs } }); writeJsonWithRetry({ filePath: absolute, value: manifest }); }
}

export function releaseSealedRunnerSteward(input: { readonly cwd: string; readonly admission: RunnerSyncAdmissionReport; readonly receiptRef: string; }): void {
  if (process.env.ATM_RUNNER_SYNC_AUTO_RELEASE === '0') return;
  const taskId = input.admission.queueHeadOwnership.waitingTasks[0] ?? ''; const stewardWorkId = input.admission.queueHeadOwnership.stewardWorkId ?? ''; if (!taskId || !stewardWorkId) return;
  const receiptPath = path.join(input.cwd, input.receiptRef); const receiptDigest = `sha256:${createHash('sha256').update(readFileSync(receiptPath, 'utf8')).digest('hex')}`; const retryCommand = buildRunnerSyncReleaseCommand({ taskId, stewardWorkId, receiptRef: input.receiptRef, receiptDigest });
  const result = spawnSync(process.execPath, ['atm.mjs', 'broker', 'runner-sync', 'release', '--task', taskId, '--steward-work-id', stewardWorkId, '--receipt-ref', input.receiptRef, '--receipt-digest', receiptDigest, '--json'], { cwd: input.cwd, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`Runner-sync steward auto-release failed after receipt publication. Retry: ${retryCommand}\n${result.stderr || result.stdout}`);
}

function readDirectoryNames(directory: string): readonly string[] { return existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : []; }
