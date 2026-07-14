import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertRootLauncherSafeForReleaseBuild,
  assertStableLauncherTemplatePresent,
  resolveStableLauncherTemplatePath
} from './launcher-entrypoint-guards.ts';

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

export function buildRootDropRelease(options: any = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repoRoot);
  const releaseRoot = path.resolve(options.releaseRoot ?? defaultReleaseRoot);
  assertStableLauncherTemplatePresent(repositoryRoot);
  assertRootLauncherSafeForReleaseBuild(repositoryRoot);
  rmSync(releaseRoot, { recursive: true, force: true });
  mkdirSync(releaseRoot, { recursive: true });

  const sourceFiles = listReleaseSourceFiles(repositoryRoot);
  for (const releaseEntry of releaseEntries) {
    if (!sourceFiles.some((relativePath) => relativePath === releaseEntry || relativePath.startsWith(`${releaseEntry}/`))) {
      throw new Error(`release bundle source is missing: ${releaseEntry}`);
    }
  }
  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(repositoryRoot, relativePath);
    const targetPath = path.join(releaseRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
  const stableLauncherTemplatePath = resolveStableLauncherTemplatePath(repositoryRoot);
  writeFileSync(
    path.join(releaseRoot, 'atm.mjs'),
    readFileSync(stableLauncherTemplatePath, 'utf8'),
    'utf8'
  );

  const bundleReadmePath = path.join(releaseRoot, 'README.root-drop.md');
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
  writeFileSync(bundleReadmePath, `${bundleReadme}\n`, 'utf8');
  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  const generatedFiles = collectGeneratedArtifactPaths(releaseRoot, 'release/atm-root-drop', [
    'release-manifest.json'
  ]);
  const manifest = {
    schemaVersion: 'atm.rootDropRelease.v0.3',
    generatedAt: resolveReleaseGeneratedAt(),
    releaseRoot: 'release/atm-root-drop',
    entrypoint: 'atm.mjs',
    entries: ['atm.mjs', ...releaseEntries],
    generatedFiles,
    stagingContract: {
      schemaId: 'atm.generatedArtifactStaging.v1',
      generatedFiles,
      ignoredByDefault: true,
      requiresExplicitStaging: true,
      contractSurface: 'release-manifest.json',
      rationale: 'release/atm-root-drop is generated under the repo ignore boundary; use this list instead of operator memory when staging governed release artifacts.'
    }
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    releaseRoot,
    manifestPath,
    entrypointPath: path.join(releaseRoot, 'atm.mjs'),
    entryCount: releaseEntries.length
  };
}

function listReleaseSourceFiles(repositoryRoot: string) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ls-files failed while building root-drop release: ${result.stderr || result.stdout}`);
  }
  const sourceFiles = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => entry.replace(/\\/g, '/'))
    .filter((relativePath) => releaseEntries.some((releaseEntry) => relativePath === releaseEntry || relativePath.startsWith(`${releaseEntry}/`)))
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
  const result = buildRootDropRelease();
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
