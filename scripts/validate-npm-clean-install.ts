import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
type PackageSpec = {
  readonly name: string;
  readonly directory: string;
  readonly publishFiles?: readonly string[];
  readonly bin?: string;
};

const fixture = JSON.parse(readFileSync(path.join(root, 'tests', 'package-skeleton.fixture.json'), 'utf8')) as {
  readonly packages: readonly PackageSpec[];
  readonly publishClosure?: { readonly publishedPackages?: readonly string[] };
};
const publishedNames = new Set(fixture.publishClosure?.publishedPackages ?? []);
const binByName: Record<string, string> = {
  '@ai-atomic-framework/cli': 'atm',
  'create-atm': 'create-atm'
};
// Every workspace keeps its manifest obligations; only the declared publish
// closure is packed and installed, because only it reaches an adopter.
const publishedPackages = fixture.packages
  .filter((packageSpec) => publishedNames.has(packageSpec.name))
  .map((packageSpec) => ({ ...packageSpec, bin: binByName[packageSpec.name] }));

function fail(message: string): never {
  throw new Error(`[npm-clean-install] ${message}`);
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function expectedPublishFiles(packageSpec: PackageSpec): readonly string[] {
  return packageSpec.publishFiles ?? ['dist'];
}

function assertAllowedFiles(entry: any, packageSpec: PackageSpec): void {
  const allowedRoots = expectedPublishFiles(packageSpec);
  for (const file of entry.files ?? []) {
    const packedPath = String(file.path ?? '');
    if (['package.json', 'README.md', 'LICENSE', 'LICENSE.md', 'NOTICE'].includes(packedPath)) continue;
    if (allowedRoots.some((rootPath) => packedPath === rootPath || packedPath.startsWith(`${rootPath}/`))) continue;
    fail(`${entry.name} packs disallowed path ${packedPath}`);
  }
}

function listFiles(directory: string, results: string[] = []): string[] {
  if (!existsSync(directory)) return results;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(fullPath, results);
    else results.push(fullPath);
  }
  return results;
}

// A published tarball carries only its own package directory. A relative
// specifier that escapes that directory therefore resolves to nothing once the
// tarball is installed on its own, no matter how well it resolves inside the
// monorepo. This is the invariant the beta.1 release violated.
function assertNoEscapingSpecifiers(packageSpec: PackageSpec): void {
  const packageRoot = path.join(root, packageSpec.directory);
  const offenders: string[] = [];
  for (const publishRoot of expectedPublishFiles(packageSpec)) {
    for (const filePath of listFiles(path.join(packageRoot, publishRoot))) {
      if (!/\.[cm]?js$/.test(filePath)) continue;
      const source = readFileSync(filePath, 'utf8');
      const patterns = [/from\s+['"](\.[^'"]*)['"]/g, /import\s+['"](\.[^'"]*)['"]/g, /import\(\s*['"](\.[^'"]*)['"]\s*\)/g];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const resolved = path.resolve(path.dirname(filePath), match[1]!);
          if (resolved.startsWith(`${packageRoot}${path.sep}`)) continue;
          offenders.push(`${path.relative(root, filePath)} -> ${match[1]}`);
        }
      }
    }
  }
  if (offenders.length > 0) {
    fail(`${packageSpec.name} publishes specifiers that escape its own tarball: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ` (+${offenders.length - 5} more)` : ''}`);
  }
}

if (publishedPackages.length === 0) {
  fail('tests/package-skeleton.fixture.json must declare publishClosure.publishedPackages');
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-product-clean-install-'));
try {
  for (const packageSpec of fixture.packages) {
    const manifest = JSON.parse(readFileSync(path.join(root, packageSpec.directory, 'package.json'), 'utf8'));
    if (JSON.stringify(manifest.files) !== JSON.stringify(expectedPublishFiles(packageSpec))) {
      fail(`${packageSpec.name} files allowlist must contain only declared runtime artifacts`);
    }
    const binName = binByName[packageSpec.name];
    if (binName && manifest.bin?.[binName]?.startsWith('./')) {
      fail(`${packageSpec.name} bin.${binName} must not start with ./ because npm removes that entry at publish time`);
    }
  }

  for (const packageSpec of publishedPackages) {
    // A published workspace may not depend on any workspace left unpublished.
    const manifest = JSON.parse(readFileSync(path.join(root, packageSpec.directory, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (publishedNames.has(dependency)) continue;
      if (fixture.packages.some((entry) => entry.name === dependency)) {
        fail(`${packageSpec.name} declares unpublished workspace dependency ${dependency}; the published tarball must be self-contained`);
      }
    }
    assertNoEscapingSpecifiers(packageSpec);
  }

  const workspaceArgs = publishedPackages.flatMap((packageSpec) => ['--workspace', packageSpec.name]);
  const packed = JSON.parse(run('npm', ['pack', ...workspaceArgs, '--pack-destination', tempRoot, '--json'], root));
  if (!Array.isArray(packed) || packed.length !== publishedPackages.length) {
    fail(`npm pack must return exactly ${publishedPackages.length} published workspace artifact(s)`);
  }
  const byName = new Map(packed.map((entry: any) => [entry.name, entry]));
  for (const packageSpec of publishedPackages) {
    const entry = byName.get(packageSpec.name);
    if (!entry) fail(`missing packed artifact for ${packageSpec.name}`);
    assertAllowedFiles(entry, packageSpec);
  }

  // Each published tarball is installed on its own, never alongside its
  // siblings, so a cross-package resolution can never be satisfied by accident.
  for (const packageSpec of publishedPackages) {
    const tarball = path.join(tempRoot, byName.get(packageSpec.name).filename);
    if (!existsSync(tarball)) fail(`npm pack did not create the ${packageSpec.name} tarball`);
    const installRoot = path.join(tempRoot, `clean-install-${packageSpec.name.replace(/[^a-z0-9]+/gi, '-')}`);
    mkdirSync(installRoot, { recursive: true });
    run('npm', ['init', '--yes'], installRoot);
    run('npm', ['install', '--ignore-scripts', '--no-save', tarball], installRoot);
    if (!packageSpec.bin) continue;
    const bin = process.platform === 'win32' ? `${packageSpec.bin}.cmd` : packageSpec.bin;
    const binPath = path.join(installRoot, 'node_modules', '.bin', bin);
    if (!existsSync(binPath)) fail(`installed ${packageSpec.name} does not expose ${packageSpec.bin}`);
    // --help alone can pass while the deeper command graph is unresolvable, so
    // exercise commands that actually load the runtime closure.
    const smokeCommands = packageSpec.name === 'create-atm' ? [['--help']] : [['--version'], ['--help'], ['doctor', '--json']];
    for (const smokeArgs of smokeCommands) {
      const smoke = spawnSync(binPath, smokeArgs, { cwd: installRoot, encoding: 'utf8', shell: process.platform === 'win32' });
      const smokeText = `${smoke.stdout ?? ''}${smoke.stderr ?? ''}`;
      if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(smokeText)) {
        fail(`${packageSpec.bin} ${smokeArgs.join(' ')} could not resolve its own runtime after a clean install: ${smokeText.split('\n').slice(0, 6).join(' ')}`);
      }
      if (packageSpec.name === 'create-atm') {
        if (smoke.status !== 0 && smoke.status !== 1) fail(`create-atm --help exited ${smoke.status}`);
        if (!smokeText.includes('Usage: create-atm')) fail('create-atm did not expose its usage text after clean install');
      } else if (smoke.status !== 0) {
        fail(`${packageSpec.bin} ${smokeArgs.join(' ')} failed after clean install: ${smokeText}`);
      }
    }
  }
  console.log(JSON.stringify({
    ok: true,
    schemaId: 'atm.npmCleanInstallValidation.v1',
    skeletonPackages: fixture.packages.length,
    publishedPackages: publishedPackages.map((packageSpec) => packageSpec.name),
    isolatedInstall: true
  }, null, 2));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
