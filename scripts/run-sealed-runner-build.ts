import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildRunnerSyncBuildObservation,
  buildRunnerSyncReceipt,
  phaseTimingsRecord,
  planRunnerIncrementalBuild,
  prepareTsBuildCache,
  persistTsBuildCache,
  summarizeDominantPhase,
  writeRunnerBuildRuntimeTelemetry,
  writeRunnerSyncReceipt,
  type RunnerIncrementalBuildPlan,
  type RunnerSyncReceipt,
  type TsBuildCacheSummary
} from './runner-sync-incremental-build.ts';
import { scanSealedRunnerBuildOutputInventory } from '../packages/core/src/broker/runner-build-output-inventory.ts';
import type { RunnerSyncAdmissionReport } from '../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import { computeBuildInputsTreeHash } from './runner-input-tree.ts';
import { captureSealedRunnerPublicationSnapshot, resolveSealedRunnerPublication } from './sealed-runner-publication.ts';
import { hydrateSealedPackageDist, releaseSealedRunnerSteward, syncSealedBuildArtifacts, writeSealedBuildMetadata } from './sealed-runner-artifact-lifecycle.ts';
import { hydrateVerifiedRootDropBase } from './build-root-drop-release.ts';
export { computeBuildInputsTreeHash } from './runner-input-tree.ts';

export type BuildTarget = 'full' | 'packages' | 'root-drop' | 'onefile';
export type BuildDecision = 'built' | 'cacheHitSkip' | 'incrementalBuild' | 'fullRebuild';
type RunnerSyncPhaseTimings = ReturnType<typeof phaseTimingsRecord>;
export {
  buildRunnerSyncReceipt,
  planRunnerIncrementalBuild,
  writeRunnerSyncReceipt,
  type RunnerIncrementalBuildPlan,
  type RunnerSyncReceipt
} from './runner-sync-incremental-build.ts';
export { syncSealedBuildArtifacts as syncGeneratedArtifacts, writeSealedBuildMetadata as writeBuildMetadataToReleaseManifests } from './sealed-runner-artifact-lifecycle.ts';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const invokedAsCli = process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
const releaseManifestPaths = [path.join('release', 'atm-root-drop', 'release-manifest.json'), path.join('release', 'atm-onefile', 'release-manifest.json')] as const;

/**
 * Remove a path without following directory junctions/symlinks.
 * Windows sealed builds link worktree/node_modules -> host node_modules via
 * junction; recursive rmSync would traverse into the host tree and wipe it.
 */
export function removeTreeWithoutFollowingLinks(targetPath: string): void {
  if (!existsSync(targetPath)) return;

  let stats;
  try {
    stats = lstatSync(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return;
    throw error;
  }

  if (stats.isSymbolicLink()) {
    unlinkSync(targetPath);
    return;
  }

  if (stats.isDirectory()) {
    for (const entry of readdirSync(targetPath)) {
      removeTreeWithoutFollowingLinks(path.join(targetPath, entry));
    }
    try {
      rmdirSync(targetPath);
    } catch {
      // Fall back for non-empty races; still never follow links.
      rmSync(targetPath, { recursive: false, force: true });
    }
    return;
  }

  unlinkSync(targetPath);
}

export function isReparsePointOrSymlink(targetPath: string): boolean {
  try {
    return lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

if (invokedAsCli) {
  const target = parseTarget(process.argv.slice(2));
  if (process.argv.includes('--inner')) {
    runInnerBuild(target);
  } else {
    runSealedBuild(target);
  }
}

function runSealedBuild(buildTarget: BuildTarget): void {
  const timings = createPhaseTimings();
  const actorId = process.env.ATM_ACTOR_ID?.trim()
    || process.env.AGENT_IDENTITY?.trim()
    || 'release-steward';
  const actorIdentitySource = process.env.ATM_ACTOR_ID?.trim()
    ? 'ATM_ACTOR_ID'
    : process.env.AGENT_IDENTITY?.trim()
      ? 'AGENT_IDENTITY'
      : 'fallback';
  const publicationTaskId = process.env.ATM_RUNNER_PUBLICATION_TASK?.trim() || null;
  const sealedSourceSha = readGitScalar(repoRoot, ['rev-parse', '--verify', 'HEAD']);
  if (!sealedSourceSha) fail('Unable to resolve sealed source SHA from HEAD.', 1);
  // A takeover receipt authorizes the pre-existing live surface. Capture it
  // before the private build writes generated candidate outputs; recapturing
  // after that work would make every valid receipt fail its own CAS check.
  const preBuildPublicationSnapshots = captureSealedRunnerPublicationSnapshot({
    cwd: repoRoot,
    stewardActorId: actorId,
    buildTarget,
    publicationTaskId
  });

  const buildInputsTreeHash = timePhase(timings, 'inputHashCalculationMs', () => computeBuildInputsTreeHash(repoRoot, sealedSourceSha));
  const cacheDecision = timePhase(timings, 'skipDecisionMs', () => inspectBuildCache({
    cwd: repoRoot,
    buildTarget,
    buildInputsTreeHash
  }));
  if (cacheDecision.decision === 'cacheHitSkip') {
    const publication = resolveSealedRunnerPublication({
      cwd: repoRoot,
      stewardActorId: actorId,
      sealedSourceSha,
      buildTarget,
      publicationTaskId,
      beforeBuildSnapshot: preBuildPublicationSnapshots.scopedSnapshot,
      beforeBuildTakeoverSnapshot: preBuildPublicationSnapshots.takeoverSnapshot
    });
    timings.totalElapsedMs = elapsedSince(timings.startedAt);
    const dominantPhaseSummary = summarizeDominantPhase(timings);
    const runtimeTelemetryRef = writeRunnerBuildRuntimeTelemetry({
      cwd: repoRoot,
      actorId,
      sealedSourceSha,
      buildTarget,
      buildInputsTreeHash,
      buildDecision: cacheDecision.decision,
      decisionReason: cacheDecision.reason,
      incrementalPlan: null,
      tsBuildCache: null,
      timings,
      dominantPhaseSummary
    });
    timePhase(timings, 'artifactSyncMs', () => writeSealedBuildMetadata({
      cwd: repoRoot,
      sealedSourceSha,
      buildInputsTreeHash,
      buildDecision: cacheDecision.decision,
      decisionReason: cacheDecision.reason,
      incrementalPlan: null,
      runtimeTelemetryRef,
      tsBuildCache: null,
      timings,
      dominantPhaseSummary
    }));
    const receiptRef = writeRunnerSyncReceipt({
      cwd: repoRoot,
      admission: publication.admission,
      actorId,
      actorIdentitySource,
      sealedSourceSha,
      outputInventory: scanSealedRunnerBuildOutputInventory({ cwd: repoRoot, buildTarget, sealedSourceSha, taskId: publication.currentTaskId, beforeBuildSnapshot: publication.beforeBuildSnapshot, includeDirtyPublicationMembers: true, takeoverPaths: publication.takeoverPaths }),
      buildTarget,
      buildInputsTreeHash,
      buildDecision: cacheDecision.decision,
      decisionReason: cacheDecision.reason,
      incrementalPlan: null,
      runtimeTelemetryRef,
      tsBuildCache: null,
      timings,
      dominantPhaseSummary
    });
    releaseSealedRunnerSteward({ cwd: repoRoot, admission: publication.admission, receiptRef });
    console.log(`[sealed-runner-build] cacheHitSkip ${buildTarget} from ${sealedSourceSha}`);
    return;
  }

  const incrementalPlan = timePhase(timings, 'skipDecisionMs', () => planRunnerIncrementalBuild({
    cwd: repoRoot,
    currentSealedSourceSha: sealedSourceSha
  }));
  const buildDecision: BuildDecision = buildTarget === 'full' && incrementalPlan.incrementalEligible
    ? 'incrementalBuild'
    : 'fullRebuild';
  const decisionReason = buildDecision === 'incrementalBuild'
    ? `diff planner selected ${incrementalPlan.affectedPackages.length} affected package(s)`
    : (incrementalPlan.unsafeReasons[0] ?? cacheDecision.reason);

  const worktreeRoot = path.join(repoRoot, '.atm-temp', 'sealed-runner-build', `${process.pid}-${sealedSourceSha.slice(0, 12)}`);
  removeTreeWithoutFollowingLinks(worktreeRoot);
  mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  let tsBuildCache: TsBuildCacheSummary | null = null;
  let rootDropOverlayReady = false;
  try {
    timePhase(timings, 'worktreeSetupMs', () => runGit(repoRoot, ['worktree', 'add', '--detach', worktreeRoot, sealedSourceSha]));
    linkNodeModules(worktreeRoot);
    if (buildDecision === 'incrementalBuild') {
      hydrateSealedPackageDist({ cwd: repoRoot, worktreeRoot, removeTree: removeTreeWithoutFollowingLinks });
      rootDropOverlayReady = hydrateVerifiedRootDropBase({
        sourceReleaseRoot: path.join(repoRoot, 'release', 'atm-root-drop'),
        targetReleaseRoot: path.join(worktreeRoot, 'release', 'atm-root-drop'),
        previousSealedSourceSha: incrementalPlan.previousSealedSourceSha,
        removeTree: removeTreeWithoutFollowingLinks
      });
    }
    if (buildTarget === 'full' || buildTarget === 'packages') {
      tsBuildCache = prepareTsBuildCache({ cwd: repoRoot, worktreeRoot });
    }
    runTimedInnerBuild(worktreeRoot, buildTarget, timings, rootDropOverlayReady ? incrementalPlan : null);
    tsBuildCache = persistTsBuildCache({ cwd: repoRoot, worktreeRoot, summary: tsBuildCache });
    // The detached worktree build is intentionally queue-free.  The queue is a
    // publication mutex, not a build reservation: only acquire/revalidate it
    // after the candidate is complete and immediately before root mutation.
    const publication = resolveSealedRunnerPublication({
      cwd: repoRoot,
      stewardActorId: actorId,
      sealedSourceSha,
      buildTarget,
      publicationTaskId,
      beforeBuildSnapshot: preBuildPublicationSnapshots.scopedSnapshot,
      beforeBuildTakeoverSnapshot: preBuildPublicationSnapshots.takeoverSnapshot
    });
    const artifactSync = timePhase(
      timings,
      'artifactSyncMs',
      () => syncSealedBuildArtifacts(
        worktreeRoot,
        repoRoot,
        buildTarget,
        publication.beforeBuildSnapshot.preexistingDirtyPaths.filter((entry) => !publication.takeoverPaths.includes(entry)),
      ),
    );
    if (artifactSync.preservedPaths.length > 0) {
      // Foreign generated bytes must never be overwritten.  They are still a
      // terminal queue outcome, however: publish an inventory-bound recovery
      // receipt and release the short publication reservation before reporting
      // that this sealed generation was not published.
      timings.totalElapsedMs = elapsedSince(timings.startedAt);
      const outputInventory = scanSealedRunnerBuildOutputInventory({
        cwd: repoRoot,
        buildTarget,
        sealedSourceSha,
        taskId: publication.currentTaskId,
        beforeBuildSnapshot: publication.beforeBuildSnapshot,
        includeDirtyPublicationMembers: true,
        takeoverPaths: publication.takeoverPaths
      });
      const dominantPhaseSummary = summarizeDominantPhase(timings);
      const receiptRef = writeRunnerSyncReceipt({
        cwd: repoRoot,
        admission: publication.admission,
        actorId,
        actorIdentitySource,
        sealedSourceSha,
        outputInventory,
        buildTarget,
        buildInputsTreeHash,
        buildDecision,
        decisionReason: `foreign generated outputs retained: ${artifactSync.preservedPaths.join(', ')}`,
        publicationDisposition: 'recovery-retained',
        recoveryRetainedPaths: artifactSync.preservedPaths,
        incrementalPlan,
        runtimeTelemetryRef: null,
        tsBuildCache,
        timings,
        dominantPhaseSummary
      });
      releaseSealedRunnerSteward({ cwd: repoRoot, admission: publication.admission, receiptRef });
      throw new Error(
        `Runner publication incomplete: preserved foreign generated outputs were not replaced by sealed build ${sealedSourceSha}: ${artifactSync.preservedPaths.join(', ')}`,
      );
    }
    timings.totalElapsedMs = elapsedSince(timings.startedAt);
    writeSealedBuildMetadata({
      cwd: repoRoot,
      sealedSourceSha,
      buildInputsTreeHash,
      buildDecision,
      decisionReason,
      incrementalPlan,
      runtimeTelemetryRef: null,
      tsBuildCache,
      timings,
      preservePaths: publication.beforeBuildSnapshot.preexistingDirtyPaths
    });
    const dominantPhaseSummary = summarizeDominantPhase(timings);
    const runtimeTelemetryRef = writeRunnerBuildRuntimeTelemetry({
      cwd: repoRoot,
      actorId,
      sealedSourceSha,
      buildTarget,
      buildInputsTreeHash,
      buildDecision,
      decisionReason,
      incrementalPlan,
      tsBuildCache,
      timings,
      dominantPhaseSummary
    });
    const receiptRef = writeRunnerSyncReceipt({
      cwd: repoRoot,
      admission: publication.admission,
      actorId,
      actorIdentitySource,
      sealedSourceSha,
      outputInventory: scanSealedRunnerBuildOutputInventory({ cwd: repoRoot, buildTarget, sealedSourceSha, taskId: publication.currentTaskId, beforeBuildSnapshot: publication.beforeBuildSnapshot, includeDirtyPublicationMembers: true, takeoverPaths: publication.takeoverPaths }),
      buildTarget,
      buildInputsTreeHash,
      buildDecision,
      decisionReason,
      incrementalPlan,
      runtimeTelemetryRef,
      tsBuildCache,
      timings,
      dominantPhaseSummary
    });
    releaseSealedRunnerSteward({ cwd: repoRoot, admission: publication.admission, receiptRef });
    console.log(`[sealed-runner-build] ${buildDecision} ${buildTarget} from ${sealedSourceSha}`);
  } finally {
    // CRITICAL: unlink the node_modules junction BEFORE git worktree remove.
    // On Windows, `git worktree remove --force` can traverse the junction and
    // wipe the host repo node_modules that the junction points at.
    unlinkWorktreeNodeModulesLink(worktreeRoot);
    timePhase(timings, 'cleanupMs', () => {
      const remove = spawnSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      if ((remove.status ?? 1) !== 0 || existsSync(worktreeRoot)) {
        unlinkWorktreeNodeModulesLink(worktreeRoot);
        removeTreeWithoutFollowingLinks(worktreeRoot);
      }
    });
    timings.totalElapsedMs = elapsedSince(timings.startedAt);
  }
}

function runTimedInnerBuild(
  worktreeRoot: string,
  buildTarget: BuildTarget,
  timings: SealedBuildTimings,
  incrementalPlan: RunnerIncrementalBuildPlan | null = null
): void {
  if (buildTarget === 'full') {
    const packageArgs = incrementalPlan?.affectedPackages.length ? ['--packages', incrementalPlan.affectedPackages.join(',')] : [];
    timePhase(timings, 'typescriptBuildMs', () => runNode(worktreeRoot, ['--strip-types', 'scripts/run-sealed-runner-build.ts', '--inner', 'packages', ...packageArgs]));
    const overlayArgs = incrementalPlan ? ['--overlay-paths', JSON.stringify(incrementalPlan.changedPaths), '--previous-sealed-source', incrementalPlan.previousSealedSourceSha ?? ''] : [];
    timePhase(timings, 'rootDropAssemblyMs', () => runNode(worktreeRoot, ['--strip-types', 'scripts/run-sealed-runner-build.ts', '--inner', 'root-drop', ...overlayArgs]));
    timePhase(timings, 'onefileAssemblyMs', () => runNode(worktreeRoot, ['--strip-types', 'scripts/run-sealed-runner-build.ts', '--inner', 'onefile']));
    return;
  }
  const phase = buildTarget === 'packages'
    ? 'typescriptBuildMs'
    : buildTarget === 'root-drop'
      ? 'rootDropAssemblyMs'
      : 'onefileAssemblyMs';
  timePhase(timings, phase, () => runNode(worktreeRoot, ['--strip-types', 'scripts/run-sealed-runner-build.ts', '--inner', buildTarget]));
}

export interface SealedBuildTimings {
  readonly startedAt: number;
  inputHashCalculationMs: number;
  skipDecisionMs: number;
  worktreeSetupMs: number;
  typescriptBuildMs: number;
  rootDropAssemblyMs: number;
  onefileAssemblyMs: number;
  artifactSyncMs: number;
  cleanupMs: number;
  totalElapsedMs: number;
}

function createPhaseTimings(): SealedBuildTimings {
  return {
    startedAt: Date.now(),
    inputHashCalculationMs: 0,
    skipDecisionMs: 0,
    worktreeSetupMs: 0,
    typescriptBuildMs: 0,
    rootDropAssemblyMs: 0,
    onefileAssemblyMs: 0,
    artifactSyncMs: 0,
    cleanupMs: 0,
    totalElapsedMs: 0
  };
}

function timePhase<T>(timings: SealedBuildTimings, phase: keyof Omit<SealedBuildTimings, 'startedAt' | 'totalElapsedMs'>, callback: () => T): T {
  const started = Date.now();
  try {
    return callback();
  } finally {
    timings[phase] += elapsedSince(started);
  }
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

export function inspectBuildCache(input: {
  readonly cwd: string;
  readonly buildTarget: BuildTarget;
  readonly buildInputsTreeHash: string;
}): { readonly decision: BuildDecision; readonly reason: string } {
  if (input.buildTarget !== 'full') {
    return { decision: 'built', reason: 'partial build targets do not use cache skip' };
  }
  for (const relative of releaseManifestPaths) {
    const absolute = path.join(input.cwd, relative);
    if (!existsSync(absolute)) {
      return { decision: 'fullRebuild', reason: `${relative} is missing` };
    }
    const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>;
    if (parsed.buildInputsTreeHash !== input.buildInputsTreeHash) {
      return { decision: 'fullRebuild', reason: `${relative} buildInputsTreeHash mismatch` };
    }
  }
  const dirty = spawnSync('git', ['diff', '--quiet', '--', ...releaseManifestPaths, 'release/atm-root-drop/atm.mjs', 'release/atm-onefile/atm.mjs'], {
    cwd: input.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((dirty.status ?? 1) !== 0) {
    return { decision: 'fullRebuild', reason: 'release artifacts are dirty or missing' };
  }
  return { decision: 'cacheHitSkip', reason: 'build input tree hash matches release manifests' };
}

export function shouldAutoReleaseRunnerSyncSteward(env: NodeJS.ProcessEnv = process.env): boolean { return env.ATM_RUNNER_SYNC_AUTO_RELEASE !== '0'; }

export function unlinkWorktreeNodeModulesLink(worktreeRoot: string): void {
  const linkedModules = path.join(worktreeRoot, 'node_modules');
  try {
    if (lstatSync(linkedModules).isSymbolicLink()) {
      unlinkSync(linkedModules);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return;
    throw error;
  }
}

function runInnerBuild(buildTarget: BuildTarget): void {
  if (buildTarget === 'full' || buildTarget === 'packages') {
    const tscPath = path.join('node_modules', 'typescript', 'bin', 'tsc');
    if (!existsSync(path.join(process.cwd(), tscPath))) {
      fail('Local TypeScript dependency is missing; run npm install/npm ci before sealed runner build.', 1);
    }
    runNode(process.cwd(), [
      tscPath,
      '-p',
      'tsconfig.build.json',
      '--incremental',
      '--tsBuildInfoFile',
      path.join('.atm-runtime-cache', 'tsconfig.build.tsbuildinfo')
    ]);
    const packagesIndex = process.argv.indexOf('--packages');
    const packageArgs = packagesIndex >= 0 && process.argv[packagesIndex + 1] ? ['--packages', process.argv[packagesIndex + 1]] : [];
    runNode(process.cwd(), ['--strip-types', 'scripts/build-package-dist.ts', ...packageArgs]);
  }
  if (buildTarget === 'full' || buildTarget === 'root-drop') {
    const overlayIndex = process.argv.indexOf('--overlay-paths');
    const previousIndex = process.argv.indexOf('--previous-sealed-source');
    const overlayArgs = overlayIndex >= 0 ? ['--overlay-paths', process.argv[overlayIndex + 1] || '[]', '--previous-sealed-source', previousIndex >= 0 ? process.argv[previousIndex + 1] || '' : ''] : [];
    runNode(process.cwd(), ['--strip-types', 'scripts/build-root-drop-release.ts', ...overlayArgs]);
  }
  if (buildTarget === 'full' || buildTarget === 'onefile') {
    runNode(process.cwd(), ['--strip-types', 'scripts/build-onefile-release.ts']);
  }
}

export function hydratePackageDistFromCurrentRootDrop(input: { readonly cwd: string; readonly worktreeRoot: string; }): void { hydrateSealedPackageDist({ ...input, removeTree: removeTreeWithoutFollowingLinks }); }

function linkNodeModules(worktreeRoot: string): void {
  const source = path.join(repoRoot, 'node_modules');
  const target = path.join(worktreeRoot, 'node_modules');
  if (!existsSync(source) || existsSync(target)) return;
  try {
    symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    // The inner build emits the actionable module-resolution error.
  }
}

function readDirectoryNames(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function parseTarget(argv: readonly string[]): BuildTarget {
  const positional = argv.find((entry) => !entry.startsWith('--')) ?? 'full';
  if (positional === 'full' || positional === 'packages' || positional === 'root-drop' || positional === 'onefile') {
    return positional;
  }
  fail(`Unsupported sealed runner build target: ${positional}`, 2);
}

function runGit(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'inherit' });
  if ((result.status ?? 1) !== 0 || result.error) fail(`git ${args.join(' ')} failed.`, result.status ?? 1);
}

function runNode(cwd: string, args: readonly string[]): void {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: { ...process.env, ATM_SEALED_RUNNER_BUILD_INNER: '1' },
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if ((result.status ?? 1) !== 0 || result.error) fail(`node ${args.join(' ')} failed.`, result.status ?? 1);
}

function readGitScalar(cwd: string, args: readonly string[]): string | null {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.trim() || null;
}

function fail(message: string, exitCode: number): never {
  console.error(JSON.stringify({ ok: false, code: 'ATM_SEALED_RUNNER_BUILD_FAILED', message }, null, 2));
  process.exit(exitCode);
}
