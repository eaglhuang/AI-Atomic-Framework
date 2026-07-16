import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertRunnerSyncAdmission,
  inspectRunnerSyncAdmission
} from '../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

type BuildTarget = 'full' | 'packages' | 'root-drop' | 'onefile';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = parseTarget(process.argv.slice(2));

if (process.argv.includes('--inner')) {
  runInnerBuild(target);
} else {
  runSealedBuild(target);
}

function runSealedBuild(buildTarget: BuildTarget): void {
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

  const worktreeRoot = path.join(repoRoot, '.atm-temp', 'sealed-runner-build', `${process.pid}-${sealedSourceSha.slice(0, 12)}`);
  rmSync(worktreeRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(worktreeRoot), { recursive: true });
  try {
    runGit(repoRoot, ['worktree', 'add', '--detach', worktreeRoot, sealedSourceSha]);
    linkNodeModules(worktreeRoot);
    runNode(worktreeRoot, ['--strip-types', 'scripts/run-sealed-runner-build.ts', '--inner', buildTarget]);
    syncGeneratedArtifacts(worktreeRoot, repoRoot, buildTarget);
    console.log(`[sealed-runner-build] built ${buildTarget} from ${sealedSourceSha}`);
  } finally {
    const remove = spawnSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if ((remove.status ?? 1) !== 0) rmSync(worktreeRoot, { recursive: true, force: true });
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
  rmSync(target, { recursive: true, force: true });
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
