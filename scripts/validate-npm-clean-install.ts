import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
};
const packages = fixture.packages.map((packageSpec) => ({
  ...packageSpec,
  bin: packageSpec.name === '@ai-atomic-framework/cli'
    ? 'atm'
    : packageSpec.name === 'create-atm'
      ? 'create-atm'
      : undefined
}));

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

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-product-clean-install-'));
try {
  for (const packageSpec of packages) {
    const manifest = JSON.parse(readFileSync(path.join(root, packageSpec.directory, 'package.json'), 'utf8'));
    if (JSON.stringify(manifest.files) !== JSON.stringify(expectedPublishFiles(packageSpec))) {
      fail(`${packageSpec.name} files allowlist must contain only declared runtime artifacts`);
    }
    if (packageSpec.bin && manifest.bin?.[packageSpec.bin]?.startsWith('./')) {
      fail(`${packageSpec.name} bin.${packageSpec.bin} must not start with ./ because npm removes that entry at publish time`);
    }
  }

  const workspaceArgs = packages.flatMap((packageSpec) => ['--workspace', packageSpec.name]);
  const packed = JSON.parse(run('npm', ['pack', ...workspaceArgs, '--pack-destination', tempRoot, '--json'], root));
  if (!Array.isArray(packed) || packed.length !== packages.length) {
    fail(`npm pack must return exactly ${packages.length} public workspace artifacts`);
  }
  const byName = new Map(packed.map((entry: any) => [entry.name, entry]));
  for (const packageSpec of packages) {
    const entry = byName.get(packageSpec.name);
    if (!entry) fail(`missing packed artifact for ${packageSpec.name}`);
    assertAllowedFiles(entry, packageSpec);
  }
  const tarballs = packages.map((packageSpec) => path.join(tempRoot, byName.get(packageSpec.name).filename));
  if (tarballs.some((tarball: string) => !existsSync(tarball))) fail('npm pack did not create every workspace tarball');
  const installRoot = path.join(tempRoot, 'clean-install');
  mkdirSync(installRoot, { recursive: true });
  run('npm', ['init', '--yes'], installRoot);
  run('npm', ['install', '--ignore-scripts', '--no-save', ...tarballs], installRoot);
  for (const packageSpec of packages) {
    if (!packageSpec.bin) continue;
    const bin = process.platform === 'win32' ? `${packageSpec.bin}.cmd` : packageSpec.bin;
    const binPath = path.join(installRoot, 'node_modules', '.bin', bin);
    if (!existsSync(binPath)) fail(`installed ${packageSpec.name} does not expose ${packageSpec.bin}`);
    const help = spawnSync(binPath, ['--help'], { cwd: installRoot, encoding: 'utf8', shell: process.platform === 'win32' });
    const helpText = `${help.stdout ?? ''}${help.stderr ?? ''}`;
    if (packageSpec.name === 'create-atm') {
      if (help.status !== 0 && help.status !== 1) fail(`create-atm --help exited ${help.status}`);
      if (!helpText.includes('Usage: create-atm')) fail('create-atm did not expose its usage text after clean install');
    } else if (help.status !== 0) {
      fail(`${packageSpec.bin} --help failed: ${helpText}`);
    }
  }
  console.log(`[npm-clean-install] ok (${packages.length} runtime-only packages install and expose their declared bins)`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
