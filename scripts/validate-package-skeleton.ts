import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'test';

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
  if (exportTarget?.import !== './dist/index.js' || exportTarget?.types !== './dist/index.d.ts') {
    fail(`${manifestPath} must export ./dist/index.js with ./dist/index.d.ts types`);
  }
  if (!Array.isArray(manifest.files) || !manifest.files.includes('dist')) {
    fail(`${manifestPath} must publish dist artifacts`);
  }
  if (manifest.types !== './dist/index.d.ts') {
    fail(`${manifestPath} must set types=./dist/index.d.ts`);
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
