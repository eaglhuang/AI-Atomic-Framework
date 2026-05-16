import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultReleaseRoot = path.join(repoRoot, 'release', 'atm-root-drop');
const releaseEntries = [
  'atm.mjs',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'atomic-registry.json',
  'atomic_workbench',
  'docs',
  'eslint.config.mjs',
  'examples',
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
  rmSync(releaseRoot, { recursive: true, force: true });
  mkdirSync(releaseRoot, { recursive: true });

  for (const relativePath of releaseEntries) {
    const sourcePath = path.join(repositoryRoot, relativePath);
    if (!existsSync(sourcePath)) {
      throw new Error(`release bundle source is missing: ${relativePath}`);
    }
    cpSync(sourcePath, path.join(releaseRoot, relativePath), { recursive: true });
  }

  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  const manifest = {
    schemaVersion: 'atm.rootDropRelease.v0.2',
    generatedAt: new Date().toISOString(),
    releaseRoot: 'release/atm-root-drop',
    entrypoint: 'atm.mjs',
    entries: [...releaseEntries]
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const bundleReadmePath = path.join(releaseRoot, 'README.root-drop.md');
  const bundleReadme = [
    '# ATM Root-Drop Release Bundle',
    '',
    'This bundle is meant to be dropped into a blank repository root or used as a self-contained ATM release snapshot.',
    '',
    '## Single-Line Prompt',
    '',
    'Read README.md if present, then run "node atm.mjs next --json" from the repository root and execute exactly the returned next action.',
    '',
    '## Entry Command',
    '',
    '`node atm.mjs next --json`'
  ].join('\n');
  writeFileSync(bundleReadmePath, `${bundleReadme}\n`, 'utf8');

  return {
    releaseRoot,
    manifestPath,
    entrypointPath: path.join(releaseRoot, 'atm.mjs'),
    entryCount: releaseEntries.length
  };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const result = buildRootDropRelease();
  const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'));
  console.log(`[build-root-drop-release] built ${manifest.entries.length} entries at ${path.relative(repoRoot, result.releaseRoot)}`);
}
