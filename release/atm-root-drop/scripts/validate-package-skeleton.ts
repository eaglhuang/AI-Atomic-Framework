import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'test';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runInstallSmoke(): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-package-install-'));
  const packRoot = path.join(tempRoot, 'pack');
  const consumerRoot = path.join(tempRoot, 'consumer');
  const startedAt = Date.now();
  try {
    mkdirSync(packRoot, { recursive: true });
    const packOutput = execFileSync(npmCommand, [
      'pack', '--workspace', 'packages/cli', '--pack-destination', packRoot, '--json', '--loglevel', 'silent'
    ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    const tarballs = readdirSync(packRoot).filter((entry) => entry.endsWith('.tgz'));
    if (tarballs.length !== 1) throw new Error(`expected exactly one packed CLI tarball, found ${tarballs.length}`);
    const tarballPath = path.join(packRoot, tarballs[0]);
    const tarballBytes = readFileSync(tarballPath);
    execFileSync(npmCommand, ['install', '--ignore-scripts', '--prefix', consumerRoot, tarballPath], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32'
    });
    const binPath = path.join(consumerRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'atm.cmd' : 'atm');
    if (!existsSync(binPath)) throw new Error(`installed package did not expose the atm bin: ${binPath}`);
    const versionOutput = execFileSync(binPath, ['--version'], {
      cwd: consumerRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32'
    });
    if (!/ATM_CLI_VERSION|framework version/i.test(versionOutput)) {
      throw new Error(`installed atm --version output was not recognized: ${versionOutput.trim()}`);
    }
    const jsonStart = packOutput.search(/\n\[\s*\{/);
    if (jsonStart < 0) throw new Error('npm pack did not emit a JSON inventory');
    const inventory = JSON.parse(packOutput.slice(jsonStart + 1)) as Array<{ files?: Array<{ path?: string }>; unpackedSize?: number; filename?: string }>;
    const files = inventory[0]?.files ?? [];
    const forbidden = files.map((entry) => String(entry.path)).filter((entry) => /(^|[\\/])(src|tests|\.atm[\\/]history|node_modules)([\\/]|$)/.test(entry));
    if (forbidden.length > 0) throw new Error(`packed CLI contains forbidden adopter files: ${forbidden.join(', ')}`);
    console.log(JSON.stringify({
      schemaId: 'atm.cleanInstallSmoke.v1', package: '@ai-atomic-framework/cli',
      tarball: inventory[0]?.filename ?? tarballs[0], tarballBytes: tarballBytes.byteLength,
      tarballSha256: createHash('sha256').update(tarballBytes).digest('hex'),
      unpackedSize: inventory[0]?.unpackedSize ?? null, entryCount: files.length,
      installCommand: 'npm install --ignore-scripts <tarball>', publicCommand: 'atm --version',
      publicCommandOutputSha256: createHash('sha256').update(versionOutput).digest('hex'),
      elapsedMs: Date.now() - startedAt, temporaryRootRemoved: true
    }));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (mode === 'install-smoke') {
  runInstallSmoke();
  process.exit(0);
}

const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'package-skeleton.fixture.json'), 'utf8'));
const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const workspacePatterns = new Set(rootPackage.workspaces || []);
const packageNames = new Set(fixture.packages.map((packageSpec: any) => packageSpec.name));

const bannedTerms = [
  '3KLife',
  'Cocos',
  'cocos-creator',
  'html-to-ucuf',
  'gacha',
  'UCUF',
  'draft-builder',
  'task-lock',
  'compute-gate',
  'doc-id-registry',
  'tools_node/',
  'assets/scripts/',
  'docs/agent-briefs/'
];

function fail(message: any) {
  console.error(`[package-skeleton:${mode}] ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath: any) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

if (!workspacePatterns.has('packages/*')) {
  fail('root package.json must include packages/* workspace');
}

if (!rootPackage.scripts?.['packages:list']) {
  fail('root package.json must include packages:list script');
}

for (const packageSpec of fixture.packages) {
  const manifestPath = `${packageSpec.directory}/package.json`;
  const sourcePath = `${packageSpec.directory}/src/index.ts`;
  const readmePath = `${packageSpec.directory}/README.md`;

  for (const relativePath of [manifestPath, sourcePath, readmePath]) {
    if (!existsSync(path.join(root, relativePath))) {
      fail(`missing package file: ${relativePath}`);
    }
  }

  if (process.exitCode) {
    continue;
  }

  const manifest = readJson(manifestPath);
  const expectedPublishFiles = Array.isArray(packageSpec.publishFiles)
    ? packageSpec.publishFiles
    : ['dist'];
  const expectedExportImport = packageSpec.exportImport ?? './dist/index.js';
  const expectedExportTypes = packageSpec.exportTypes ?? './dist/index.d.ts';
  const allowedExternalDependencies = typeof packageSpec.externalDependencies === 'object' && packageSpec.externalDependencies !== null
    ? packageSpec.externalDependencies as Record<string, unknown>
    : {};
  if (manifest.name !== packageSpec.name) {
    fail(`${manifestPath} name mismatch: expected ${packageSpec.name}`);
  }
  if (manifest.version !== rootPackage.version) {
    fail(`${manifestPath} version must match root version ${rootPackage.version}`);
  }
  if (manifest.private !== false) {
    fail(`${manifestPath} must set private=false for publishable package skeletons`);
  }
  if (manifest.type !== 'module') {
    fail(`${manifestPath} must use type=module`);
  }
  const exportTarget = manifest.exports?.['.'] ?? manifest.exports;
  if (exportTarget?.import !== expectedExportImport || exportTarget?.types !== expectedExportTypes) {
    fail(`${manifestPath} must export ${expectedExportImport} with ${expectedExportTypes} types`);
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(expectedPublishFiles)) {
    fail(`${manifestPath} files must exactly match the runtime allowlist ${JSON.stringify(expectedPublishFiles)}`);
  }
  if (manifest.types !== expectedExportTypes) {
    fail(`${manifestPath} must set types=${expectedExportTypes}`);
  }
  for (const scriptName of ['build', 'test', 'typecheck', 'lint']) {
    if (!manifest.scripts?.[scriptName]) {
      fail(`${manifestPath} missing script: ${scriptName}`);
    }
  }

  const dependencyEntries = Object.entries(manifest.dependencies || {});
  for (const [dependencyName, dependencyVersion] of dependencyEntries) {
    if (packageNames.has(dependencyName)) {
      if (dependencyVersion !== rootPackage.version) {
        fail(`${manifestPath} dependency ${dependencyName} must use root version ${rootPackage.version}`);
      }
      continue;
    }

    if (!Object.hasOwn(allowedExternalDependencies, dependencyName)) {
      fail(`${manifestPath} has non-workspace dependency outside fixture whitelist: ${dependencyName}`);
      continue;
    }

    const expectedVersion = allowedExternalDependencies[dependencyName];
    if (typeof expectedVersion !== 'string') {
      fail(`${manifestPath} fixture whitelist for ${dependencyName} must be a string version`);
      continue;
    }
    if (dependencyVersion !== expectedVersion) {
      fail(`${manifestPath} dependency ${dependencyName} must use whitelisted version ${expectedVersion}`);
    }
  }

  const source = readText(sourcePath);
  if (!source.includes(packageSpec.exportSymbol)) {
    fail(`${sourcePath} missing export symbol: ${packageSpec.exportSymbol}`);
  }
  if (mode === 'typecheck' && !source.includes('export')) {
    fail(`${sourcePath} must contain at least one export`);
  }

  const packageFiles = [manifestPath, sourcePath, readmePath];
  if (existsSync(path.join(root, `${packageSpec.directory}/src/atm.ts`))) {
    packageFiles.push(`${packageSpec.directory}/src/atm.ts`);
  }
  for (const relativePath of packageFiles) {
    const content = readText(relativePath);
    for (const term of bannedTerms) {
      if (content.includes(term)) {
        fail(`${relativePath} contains downstream-only term: ${term}`);
      }
    }
  }
}

const workspacePackageDirs = new Set(
  readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(path.join(root, 'packages', entry.name, 'package.json')))
    .map((entry) => `packages/${entry.name}`)
);

for (const packageSpec of fixture.packages) {
  workspacePackageDirs.delete(packageSpec.directory);
}

if (workspacePackageDirs.size > 0) {
  fail(`unexpected package directories: ${Array.from(workspacePackageDirs).sort().join(', ')}`);
}

if (!process.exitCode) {
  console.log(`[package-skeleton:${mode}] ok (${fixture.packages.length} packages)`);
}
