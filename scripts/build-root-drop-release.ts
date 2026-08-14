import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  assertRootLauncherSafeForReleaseBuild,
  assertStableLauncherTemplatePresent,
  resolveStableLauncherTemplatePath
} from './launcher-entrypoint-guards.ts';
import { classifyAtmCorePath, type RunnerBuildScopeManifest } from '../packages/core/src/broker/atm-core-scope.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultReleaseRoot = path.join(repoRoot, 'release', 'atm-root-drop');
const deterministicGeneratedAt = '1970-01-01T00:00:00.000Z';
const releaseEntries = [
  'CHANGELOG.md',
  'compatibility-matrix.json',
  'compatibility-matrix.legacy.json',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'atomic-registry.json',
  'atomic_workbench',
  'docs',
  'eslint.config.mjs',
  'examples',
  'fixtures',
  'integrations',
  'package-lock.json',
  'package.json',
  'packages',
  'schemas',
  'scripts',
  'specs',
  'templates',
  'tests',
  'tsconfig.build.json',
  'tsconfig.json',
  'turbo.json'
];

type RootDropArtifactInventory = {
  readonly schemaId: 'atm.rootDropArtifactInventory.v1';
  readonly entries: readonly { readonly path: string; readonly digest: string; readonly origin: 'source' | 'generated'; readonly inputPaths: readonly string[]; readonly replaceable: boolean; }[];
  readonly treeDigest: string;
};

function rootDropCompatibilityKey(): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({ schema: 'atm.rootDropRelease.v0.4', entries: releaseEntries })).digest('hex')}`;
}

export function buildRootDropRelease(options: any = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repoRoot);
  const releaseRoot = path.resolve(options.releaseRoot ?? defaultReleaseRoot);
  assertStableLauncherTemplatePresent(repositoryRoot);
  assertRootLauncherSafeForReleaseBuild(repositoryRoot);
  mkdirSync(releaseRoot, { recursive: true });

  const sourceFiles = listReleaseSourceFiles(repositoryRoot);
  const overlayPaths = normalizeOverlayPaths(options.overlayChangedPaths);
  const baseInventory = overlayPaths.length > 0 ? readVerifiedOverlayInventory(releaseRoot, options.previousSealedSourceSha) : null;
  const overlayTargets = baseInventory ? selectOverlayTargets(sourceFiles, overlayPaths) : null;
  const expectedTargets = new Set<string>();
  const copyReport = {
    schemaId: 'atm.rootDropHashCopyReport.v1',
    copied: 0,
    unchanged: 0,
    removed: 0
  };
  for (const releaseEntry of releaseEntries) {
    if (!sourceFiles.some((relativePath) => relativePath === releaseEntry || relativePath.startsWith(`${releaseEntry}/`))) {
      throw new Error(`release bundle source is missing: ${releaseEntry}`);
    }
  }
  for (const relativePath of sourceFiles) {
    expectedTargets.add(relativePath);
    if (overlayTargets && !overlayTargets.has(relativePath)) continue;
    const sourcePath = path.join(repositoryRoot, relativePath);
    const targetPath = path.join(releaseRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    if (copyFileIfChanged(sourcePath, targetPath)) {
      copyReport.copied += 1;
    } else {
      copyReport.unchanged += 1;
    }
  }
  const stableLauncherTemplatePath = resolveStableLauncherTemplatePath(repositoryRoot);
  expectedTargets.add('atm.mjs');
  if (writeTextIfChanged(
    path.join(releaseRoot, 'atm.mjs'),
    readFileSync(stableLauncherTemplatePath, 'utf8')
  )) {
    copyReport.copied += 1;
  } else {
    copyReport.unchanged += 1;
  }

  const bundleReadmePath = path.join(releaseRoot, 'README.root-drop.md');
  expectedTargets.add('README.root-drop.md');
  const bundleReadme = [
    '# ATM Root-Drop Release Bundle',
    '',
    'This bundle is meant to be dropped into a blank repository root or used as a self-contained ATM release snapshot.',
    '',
    '## Single-Line Prompt',
    '',
    'Read README.md if present, then run "node atm.mjs next --prompt \\"<current user prompt>\\" --json" from the repository root before task work. Use "node atm.mjs next --json" only as read-only orientation when no user prompt is available. If the result includes ATM_USER_NOTICE or evidence.userNotice, show it to the user before executing the returned next action.',
    '',
    '## Entry Command',
    '',
    '`node atm.mjs next --prompt "<current user prompt>" --json`'
  ].join('\n');
  if (writeTextIfChanged(bundleReadmePath, `${bundleReadme}\n`)) {
    copyReport.copied += 1;
  } else {
    copyReport.unchanged += 1;
  }
  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  expectedTargets.add('release-manifest.json');
  removeExtraneousFiles(releaseRoot, expectedTargets, copyReport);
  const generatedFiles = collectGeneratedArtifactPaths(releaseRoot, 'release/atm-root-drop', [
    'release-manifest.json'
  ]);
  const artifactInventory = buildArtifactInventory(releaseRoot, sourceFiles, expectedTargets);
  const manifest = {
    schemaVersion: 'atm.rootDropRelease.v0.4',
    generatedAt: resolveReleaseGeneratedAt(),
    releaseRoot: 'release/atm-root-drop',
    entrypoint: 'atm.mjs',
    entries: ['atm.mjs', ...releaseEntries],
    generatedFiles,
    copyReport,
    buildMode: overlayTargets ? 'overlay' : 'full',
    overlayFallbackReason: overlayPaths.length > 0 && !overlayTargets ? 'base-release-ineligible' : null,
    baseCompatibilityKey: rootDropCompatibilityKey(),
    artifactInventory,
    runnerSourceSeal: buildRunnerSourceSeal(repositoryRoot, sourceFiles),
    stagingContract: {
      schemaId: 'atm.generatedArtifactStaging.v1',
      generatedFiles,
      ignoredByDefault: true,
      requiresExplicitStaging: true,
      contractSurface: 'release-manifest.json',
      rationale: 'release/atm-root-drop is generated under the repo ignore boundary; use this list instead of operator memory when staging governed release artifacts.'
    }
  };
  writeTextIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    releaseRoot,
    manifestPath,
    entrypointPath: path.join(releaseRoot, 'atm.mjs'),
    entryCount: releaseEntries.length,
    copyReport
  };
}

export function hydrateVerifiedRootDropBase(input: { readonly sourceReleaseRoot: string; readonly targetReleaseRoot: string; readonly previousSealedSourceSha: string | null; readonly removeTree: (path: string) => void; }): boolean {
  if (!readVerifiedOverlayInventory(input.sourceReleaseRoot, input.previousSealedSourceSha)) return false;
  input.removeTree(input.targetReleaseRoot);
  mkdirSync(path.dirname(input.targetReleaseRoot), { recursive: true });
  cpSync(input.sourceReleaseRoot, input.targetReleaseRoot, { recursive: true });
  return true;
}

function normalizeOverlayPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map(normalizePath).filter(Boolean))].sort();
}

function readVerifiedOverlayInventory(releaseRoot: string, previousSealedSourceSha: unknown): RootDropArtifactInventory | null {
  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const inventory = manifest.artifactInventory as RootDropArtifactInventory | undefined;
    if (manifest.schemaVersion !== 'atm.rootDropRelease.v0.4' || manifest.baseCompatibilityKey !== rootDropCompatibilityKey()) return null;
    if (!inventory || inventory.schemaId !== 'atm.rootDropArtifactInventory.v1' || !Array.isArray(inventory.entries)) return null;
    if (typeof previousSealedSourceSha === 'string' && manifest.sealedSourceCommit !== previousSealedSourceSha) return null;
    const actual = buildInventoryTreeDigest(inventory.entries);
    if (actual !== inventory.treeDigest) return null;
    for (const entry of inventory.entries) {
      const absolute = path.join(releaseRoot, entry.path);
      if (!existsSync(absolute) || fileDigest(absolute) !== entry.digest) return null;
    }
    return inventory;
  } catch {
    return null;
  }
}

function selectOverlayTargets(sourceFiles: readonly string[], changedPaths: readonly string[]): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const changedPath of changedPaths) {
    const packageMatch = changedPath.match(/^(packages\/[^/]+)\//);
    if (packageMatch) {
      for (const sourceFile of sourceFiles) if (sourceFile === packageMatch[1] || sourceFile.startsWith(`${packageMatch[1]}/`)) targets.add(sourceFile);
      continue;
    }
    for (const sourceFile of sourceFiles) if (sourceFile === changedPath || sourceFile.startsWith(`${changedPath}/`)) targets.add(sourceFile);
  }
  return targets;
}

function buildArtifactInventory(releaseRoot: string, sourceFiles: readonly string[], expectedTargets: ReadonlySet<string>): RootDropArtifactInventory {
  const sourceSet = new Set(sourceFiles);
  const entries = [...expectedTargets].sort().filter((entry) => entry !== 'release-manifest.json').map((entry) => ({
    path: entry,
    digest: fileDigest(path.join(releaseRoot, entry)),
    origin: sourceSet.has(entry) ? 'source' as const : 'generated' as const,
    inputPaths: sourceSet.has(entry) ? [entry] : [],
    replaceable: true
  }));
  return { schemaId: 'atm.rootDropArtifactInventory.v1', entries, treeDigest: buildInventoryTreeDigest(entries) };
}

function buildInventoryTreeDigest(entries: readonly { readonly path: string; readonly digest: string }[]): string {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) hash.update(`${entry.path}\0${entry.digest}\n`);
  return `sha256:${hash.digest('hex')}`;
}

export function buildRunnerSourceSeal(repositoryRoot: string, sourceFiles: readonly string[]) {
  const scopeManifestPath = path.join(repositoryRoot, 'scripts', 'AtmCore', 'runner-build-scope.json');
  const scopeManifest = JSON.parse(readFileSync(scopeManifestPath, 'utf8')) as RunnerBuildScopeManifest;
  const files = sourceFiles
    .filter((relativePath) => classifyAtmCorePath(scopeManifest, relativePath).kind === 'atm-core')
    .sort();
  const trackedBlobIds = readCleanTrackedBlobIds(repositoryRoot);
  const hash = createHash('sha256');
  for (const relativePath of files) {
    const blobId = trackedBlobIds.get(relativePath);
    // A clean Git index blob is a content identity.  Avoid rereading thousands of
    // unchanged files during an incremental sealed build; dirty and generated
    // inputs deliberately fall back to direct byte hashing.
    hash.update(String(Buffer.byteLength(relativePath))).update(':').update(relativePath);
    if (blobId) {
      hash.update('git:').update(blobId);
    } else {
      const content = readFileSync(path.join(repositoryRoot, relativePath));
      hash.update(String(content.byteLength)).update(':').update(content);
    }
  }
  return {
    schemaId: 'atm.runnerSourceSeal.v1',
    algorithm: 'sha256',
    files,
    digest: `sha256:${hash.digest('hex')}`
  };
}

function readCleanTrackedBlobIds(repositoryRoot: string): ReadonlyMap<string, string> {
  const dirty = new Set(runGitLines(repositoryRoot, ['diff', '--name-only']).map(normalizePath));
  const blobs = new Map<string, string>();
  for (const line of runGitLines(repositoryRoot, ['ls-files', '-s'])) {
    const match = line.match(/^\d+\s+([0-9a-f]+)\s+\d+\t(.+)$/);
    if (!match) continue;
    const relativePath = normalizePath(match[2]);
    if (!dirty.has(relativePath)) blobs.set(relativePath, match[1]);
  }
  return blobs;
}

function runGitLines(repositoryRoot: string, args: readonly string[]): readonly string[] {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if ((result.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed while sealing root-drop source: ${result.stderr || result.stdout}`);
  return String(result.stdout).split(/\r?\n/).filter(Boolean);
}

function normalizePath(value: string): string { return value.replace(/\\/g, '/'); }

export function listReleaseSourceFiles(repositoryRoot: string) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ls-files failed while building root-drop release: ${result.stderr || result.stdout}`);
  }
  const sourceFiles = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replace(/\\/g, '/'))
    .filter((relativePath) => releaseEntries.some((releaseEntry) => relativePath === releaseEntry || relativePath.startsWith(`${releaseEntry}/`)))
    .filter((relativePath) => existsSync(path.join(repositoryRoot, relativePath)))
  return [...new Set([
    ...sourceFiles,
    ...listGeneratedRuntimeFiles(repositoryRoot),
    ...listRootDropTemplateFiles(repositoryRoot)
  ])].sort();
}

function listGeneratedRuntimeFiles(repositoryRoot: string) {
  const packagesRoot = path.join(repositoryRoot, 'packages');
  if (!existsSync(packagesRoot)) {
    return [];
  }
  const generated: string[] = [];
  for (const packageEntry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!packageEntry.isDirectory()) continue;
    const distRoot = path.join(packagesRoot, packageEntry.name, 'dist');
    if (!existsSync(distRoot)) continue;
    for (const absolutePath of walkFiles(distRoot)) {
      generated.push(path.relative(repositoryRoot, absolutePath).replace(/\\/g, '/'));
    }
  }
  return generated;
}

function listRootDropTemplateFiles(repositoryRoot: string) {
  const templateRoot = path.join(repositoryRoot, 'templates', 'root-drop');
  if (!existsSync(templateRoot)) {
    return [];
  }
  return walkFiles(templateRoot).map((absolutePath) => path.relative(repositoryRoot, absolutePath).replace(/\\/g, '/'));
}

function resolveReleaseGeneratedAt() {
  const explicit = process.env.ATM_RELEASE_GENERATED_AT ?? null;
  if (explicit) {
    return explicit;
  }
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH ?? null;
  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }
  return deterministicGeneratedAt;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const overlayIndex = process.argv.indexOf('--overlay-paths');
  const previousIndex = process.argv.indexOf('--previous-sealed-source');
  const overlayChangedPaths = overlayIndex >= 0 ? JSON.parse(process.argv[overlayIndex + 1] || '[]') : undefined;
  const previousSealedSourceSha = previousIndex >= 0 ? process.argv[previousIndex + 1] : undefined;
  const result = buildRootDropRelease({ overlayChangedPaths, previousSealedSourceSha });
  const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
  console.log(`[build-root-drop-release] built ${manifest.entries.length} entries at ${path.relative(repoRoot, result.releaseRoot)}`);
}

function collectGeneratedArtifactPaths(root: string, repoRelativeRoot: string, appendFiles: readonly string[] = []) {
  const generated = new Set<string>();
  for (const absolutePath of walkFiles(root)) {
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
    if (!relativePath) continue;
    generated.add(`${repoRelativeRoot}/${relativePath}`);
  }
  for (const relativePath of appendFiles) {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized) {
      generated.add(`${repoRelativeRoot}/${normalized}`);
    }
  }
  return [...generated].sort();
}

function walkFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    if (statSync(absolutePath).isDirectory()) {
      return walkFiles(absolutePath);
    }
    return [absolutePath];
  });
}

function copyFileIfChanged(source: string, target: string): boolean {
  if (existsSync(target) && fileDigest(source) === fileDigest(target)) return false;
  copyFileSync(source, target);
  return true;
}

function writeTextIfChanged(filePath: string, content: string): boolean {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return false;
  writeFileSync(filePath, content, 'utf8');
  return true;
}

function removeExtraneousFiles(root: string, expected: ReadonlySet<string>, report: { removed: number }): void {
  for (const absolutePath of walkFiles(root)) {
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
    if (expected.has(relativePath)) continue;
    unlinkSync(absolutePath);
    report.removed += 1;
  }
}

function fileDigest(filePath: string): string {
  const stats = statSync(filePath);
  return createHash('sha256').update(readFileSync(filePath)).update(String(stats.mode & 0o777)).digest('hex');
}
