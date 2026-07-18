import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertRunnerSyncAdmission,
  inspectRunnerSyncAdmission
} from '../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

type BuildTarget = 'full' | 'packages' | 'root-drop' | 'onefile';
type BuildDecision = 'built' | 'cache-hit-skip' | 'cache-miss-build';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const invokedAsCli = process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
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
  const sealedSourceSha = readGitScalar(repoRoot, ['rev-parse', '--verify', 'HEAD']);
  if (!sealedSourceSha) fail('Unable to resolve sealed source SHA from HEAD.', 1);

  assertRunnerSyncAdmission(inspectRunnerSyncAdmission({
    cwd: repoRoot,
    stewardActorId: actorId,
    sealedSourceSha
  }));

  const buildInputsTreeHash = timePhase(timings, 'inputHashCalculationMs', () => computeBuildInputsTreeHash(repoRoot, sealedSourceSha));
  const cacheDecision = timePhase(timings, 'skipDecisionMs', () => inspectBuildCache({
    cwd: repoRoot,
    buildTarget,
    buildInputsTreeHash
  }));
  if (cacheDecision.decision === 'cache-hit-skip') {
    timePhase(timings, 'artifactSyncMs', () => writeBuildMetadataToReleaseManifests({
      cwd: repoRoot,
      sealedSourceSha,
      buildInputsTreeHash,
      buildDecision: cacheDecision.decision,
      timings
    }));
    timings.totalElapsedMs = elapsedSince(timings.startedAt);
    writeBuildMetadataToReleaseManifests({
      cwd: repoRoot,
      sealedSourceSha,
      buildInputsTreeHash,
      buildDecision: cacheDecision.decision,
      timings
    });
    console.log(`[sealed-runner-build] cache-hit-skip ${buildTarget} from ${sealedSourceSha}`);
    return;
  }

  const worktreeRoot = path.join(repoRoot, '.atm-temp', 'sealed-runner-build', `${process.pid}-${sealedSourceSha.slice(0, 12)}`);
  removeTreeWithoutFollowingLinks(worktreeRoot);
  mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  try {
    timePhase(timings, 'worktreeSetupMs', () => runGit(repoRoot, ['worktree', 'add', '--detach', worktreeRoot, sealedSourceSha]));
    linkNodeModules(worktreeRoot);
    runTimedInnerBuild(worktreeRoot, buildTarget, timings);
    timePhase(timings, 'artifactSyncMs', () => syncGeneratedArtifacts(worktreeRoot, repoRoot, buildTarget));
    writeBuildMetadataToReleaseManifests({
      cwd: repoRoot,
      sealedSourceSha,
      buildInputsTreeHash,
      buildDecision: cacheDecision.decision,
      timings
    });
    console.log(`[sealed-runner-build] ${cacheDecision.decision} ${buildTarget} from ${sealedSourceSha}`);
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

function runTimedInnerBuild(worktreeRoot: string, buildTarget: BuildTarget, timings: SealedBuildTimings): void {
  if (buildTarget === 'full') {
    timePhase(timings, 'typescriptBuildMs', () => runNode(worktreeRoot, ['--strip-types', 'scripts/run-sealed-runner-build.ts', '--inner', 'packages']));
    timePhase(timings, 'rootDropAssemblyMs', () => runNode(worktreeRoot, ['--strip-types', 'scripts/run-sealed-runner-build.ts', '--inner', 'root-drop']));
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

export function computeBuildInputsTreeHash(cwd: string, commitSha = 'HEAD'): string {
  const result = spawnSync('git', ['ls-tree', '-r', '-z', commitSha, '--', ...buildInputPaths], {
    cwd,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((result.status ?? 1) !== 0 || result.error) {
    fail(`Unable to compute sealed build input tree hash: ${String(result.stderr || result.error || '')}`, result.status ?? 1);
  }
  return `sha256:${createHash('sha256').update(result.stdout).digest('hex')}`;
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
      return { decision: 'cache-miss-build', reason: `${relative} is missing` };
    }
    const parsed = readJsonRecord(absolute);
    if (parsed.buildInputsTreeHash !== input.buildInputsTreeHash) {
      return { decision: 'cache-miss-build', reason: `${relative} buildInputsTreeHash mismatch` };
    }
  }
  const dirty = spawnSync('git', ['diff', '--quiet', '--', ...releaseManifestPaths, 'release/atm-root-drop/atm.mjs', 'release/atm-onefile/atm.mjs'], {
    cwd: input.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((dirty.status ?? 1) !== 0) {
    return { decision: 'cache-miss-build', reason: 'release artifacts are dirty or missing' };
  }
  return { decision: 'cache-hit-skip', reason: 'build input tree hash matches release manifests' };
}

export function writeBuildMetadataToReleaseManifests(input: {
  readonly cwd: string;
  readonly sealedSourceSha: string;
  readonly buildInputsTreeHash: string;
  readonly buildDecision: BuildDecision;
  readonly timings: SealedBuildTimings;
}): void {
  for (const relative of releaseManifestPaths) {
    const absolute = path.join(input.cwd, relative);
    if (!existsSync(absolute)) continue;
    const manifest = readJsonRecord(absolute);
    manifest.buildInputsTreeHash = input.buildInputsTreeHash;
    manifest.sealedSourceCommit = input.sealedSourceSha;
    manifest.buildDecision = input.buildDecision;
    manifest.phaseTimingsMs = {
      inputHashCalculation: input.timings.inputHashCalculationMs,
      skipDecision: input.timings.skipDecisionMs,
      worktreeSetup: input.timings.worktreeSetupMs,
      typescriptBuild: input.timings.typescriptBuildMs,
      rootDropReleaseAssembly: input.timings.rootDropAssemblyMs,
      onefileReleaseAssembly: input.timings.onefileAssemblyMs,
      artifactSync: input.timings.artifactSyncMs,
      cleanup: input.timings.cleanupMs,
      totalElapsed: input.timings.totalElapsedMs
    };
    writeFileSync(absolute, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

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
    runNode(process.cwd(), [tscPath, '-p', 'tsconfig.build.json']);
    runNode(process.cwd(), ['--strip-types', 'scripts/build-package-dist.ts']);
  }
  if (buildTarget === 'full' || buildTarget === 'root-drop') {
    runNode(process.cwd(), ['--strip-types', 'scripts/build-root-drop-release.ts']);
  }
  if (buildTarget === 'full' || buildTarget === 'onefile') {
    runNode(process.cwd(), ['--strip-types', 'scripts/build-onefile-release.ts']);
  }
}

function syncGeneratedArtifacts(sourceRoot: string, targetRoot: string, buildTarget: BuildTarget): void {
  if (buildTarget === 'full' || buildTarget === 'packages') {
    for (const packageName of readDirectoryNames(path.join(sourceRoot, 'packages'))) {
      copyDirectory(path.join(sourceRoot, 'packages', packageName, 'dist'), path.join(targetRoot, 'packages', packageName, 'dist'));
    }
  }
  if (buildTarget === 'full' || buildTarget === 'root-drop') {
    copyDirectory(path.join(sourceRoot, 'release', 'atm-root-drop'), path.join(targetRoot, 'release', 'atm-root-drop'));
  }
  if (buildTarget === 'full' || buildTarget === 'onefile') {
    copyDirectory(path.join(sourceRoot, 'release', 'atm-onefile'), path.join(targetRoot, 'release', 'atm-onefile'));
  }
}

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) return;
  removeTreeWithoutFollowingLinks(target);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

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
