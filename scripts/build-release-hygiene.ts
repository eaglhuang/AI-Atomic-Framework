import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const trackedReleaseManifestPaths = [
  'release/atm-onefile/atm.mjs',
  'release/atm-onefile/release-manifest.json',
  'release/atm-root-drop/release-manifest.json'
] as const;

interface ReleaseManifest {
  readonly generatedFiles?: readonly unknown[];
}

export function shouldRetainReleaseArtifacts(): boolean {
  const raw = process.env.ATM_RETAIN_RELEASE_ARTIFACTS?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function describeBuildReleaseHygienePolicy(): {
  readonly retainEnvVar: 'ATM_RETAIN_RELEASE_ARTIFACTS';
  readonly defaultBehavior: 'restore-tracked-release-outputs';
  readonly retainBehavior: 'keep-generated-release-mirrors';
  readonly runnerSyncCommand: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build';
  readonly validationSafeCommand: 'npm run build:packages';
  readonly cleanupCommand: 'node --strip-types scripts/build-release-hygiene.ts --mode cleanup';
} {
  return {
    retainEnvVar: 'ATM_RETAIN_RELEASE_ARTIFACTS',
    defaultBehavior: 'restore-tracked-release-outputs',
    retainBehavior: 'keep-generated-release-mirrors',
    runnerSyncCommand: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build',
    validationSafeCommand: 'npm run build:packages',
    cleanupCommand: 'node --strip-types scripts/build-release-hygiene.ts --mode cleanup'
  };
}

function resolveGitExecutable(): string {
  const configured = process.env.ATM_GIT_EXECUTABLE?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  if (process.platform === 'win32') {
    const windowsGit = 'C:\\Program Files\\Git\\cmd\\git.exe';
    if (existsSync(windowsGit)) {
      return windowsGit;
    }
  }
  return 'git';
}

function isGitRepository(repoRoot: string): boolean {
  return existsSync(path.join(repoRoot, '.git'));
}

function listTrackedReleasePaths(repoRoot: string): ReadonlySet<string> {
  try {
    const output = execFileSync(resolveGitExecutable(), ['ls-files', '-z', '--', 'release/atm-onefile', 'release/atm-root-drop'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return new Set(output.split('\0').filter(Boolean).map((entry) => entry.replaceAll('\\', '/')));
  } catch {
    return new Set();
  }
}

function normalizeGeneratedReleasePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized.startsWith('release/atm-root-drop/')) return null;
  if (normalized.includes('/../') || normalized.endsWith('/..') || normalized === '..') return null;
  return normalized;
}

export function collectTrackedReleaseArtifactPaths(repoRoot: string): readonly string[] {
  const paths = new Set<string>(trackedReleaseManifestPaths);
  const manifestPath = path.join(repoRoot, 'release', 'atm-root-drop', 'release-manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReleaseManifest;
      for (const generatedFile of manifest.generatedFiles ?? []) {
        const normalized = normalizeGeneratedReleasePath(generatedFile);
        if (normalized) paths.add(normalized);
      }
    } catch {
      // Cleanup is best effort; keep the explicit release files even if the manifest is mid-write.
    }
  }
  return [...paths].sort();
}

export function restoreTrackedReleaseArtifacts(repoRoot: string): readonly string[] {
  if (!isGitRepository(repoRoot)) {
    return [];
  }
  const existing = collectTrackedReleaseArtifactPaths(repoRoot).filter((relativePath) =>
    existsSync(path.join(repoRoot, relativePath))
  );
  const trackedReleasePaths = listTrackedReleasePaths(repoRoot);
  const restorable = existing.filter((relativePath) => trackedReleasePaths.has(relativePath));
  if (restorable.length === 0) {
    return [];
  }
  const restored: string[] = [];
  const chunkSize = 100;
  try {
    for (let index = 0; index < restorable.length; index += chunkSize) {
      const chunk = restorable.slice(index, index + chunkSize);
      execFileSync(resolveGitExecutable(), ['restore', '--', ...chunk], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      restored.push(...chunk);
    }
    return restored;
  } catch {
    return restored;
  }
}

export function finalizeBuildReleaseHygiene(repoRoot: string): void {
  const policy = describeBuildReleaseHygienePolicy();
  if (shouldRetainReleaseArtifacts()) {
    console.log(`[build-release-hygiene] retaining release/** outputs (${policy.retainEnvVar}=1).`);
    return;
  }
  const restored = restoreTrackedReleaseArtifacts(repoRoot);
  if (restored.length > 0) {
    console.log(
      `[build-release-hygiene] restored tracked release manifests to HEAD (${restored.join(', ')}). `
      + `Set ${policy.retainEnvVar}=1 before build when runner sync must keep generated release mirrors.`
    );
    return;
  }
  console.log(
    `[build-release-hygiene] no tracked release manifests required cleanup. `
    + `Use ${policy.validationSafeCommand} when validators only need package dist, or `
    + `${policy.runnerSyncCommand} when publishing runner artifacts intentionally.`
  );
}

function main(): void {
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'finalize';
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (mode === 'cleanup') {
    const restored = restoreTrackedReleaseArtifacts(repoRoot);
    console.log(`[build-release-hygiene] cleanup restored: ${restored.length > 0 ? restored.join(', ') : '(none)'}`);
    return;
  }
  if (mode === 'policy') {
    console.log(JSON.stringify(describeBuildReleaseHygienePolicy(), null, 2));
    return;
  }
  finalizeBuildReleaseHygiene(repoRoot);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main();
}
