import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const trackedReleaseManifestPaths = [
  'release/atm-onefile/atm.mjs',
  'release/atm-onefile/release-manifest.json',
  'release/atm-root-drop/release-manifest.json'
] as const;

export function shouldRetainReleaseArtifacts(): boolean {
  const raw = process.env.ATM_RETAIN_RELEASE_ARTIFACTS?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function describeBuildReleaseHygienePolicy(): {
  readonly retainEnvVar: 'ATM_RETAIN_RELEASE_ARTIFACTS';
  readonly defaultBehavior: 'restore-tracked-release-manifests';
  readonly retainBehavior: 'keep-generated-release-mirrors';
  readonly runnerSyncCommand: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build';
  readonly validationSafeCommand: 'npm run build:packages';
  readonly cleanupCommand: 'node --strip-types scripts/build-release-hygiene.ts --mode cleanup';
  readonly publicationReceiptRequired: true;
  readonly sealedSourceStateRequired: true;
} {
  return {
    retainEnvVar: 'ATM_RETAIN_RELEASE_ARTIFACTS',
    defaultBehavior: 'restore-tracked-release-manifests',
    retainBehavior: 'keep-generated-release-mirrors',
    runnerSyncCommand: 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build',
    validationSafeCommand: 'npm run build:packages',
    cleanupCommand: 'node --strip-types scripts/build-release-hygiene.ts --mode cleanup',
    publicationReceiptRequired: true,
    sealedSourceStateRequired: true
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

export function restoreTrackedReleaseArtifacts(repoRoot: string): readonly string[] {
  if (!isGitRepository(repoRoot)) {
    return [];
  }
  const existing = trackedReleaseManifestPaths.filter((relativePath) =>
    existsSync(path.join(repoRoot, relativePath))
  );
  if (existing.length === 0) {
    return [];
  }
  try {
    execFileSync(resolveGitExecutable(), ['restore', '--', ...existing], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return existing;
  } catch {
    return [];
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
    + `${policy.runnerSyncCommand} when publishing runner artifacts intentionally with a sealed source receipt.`
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
