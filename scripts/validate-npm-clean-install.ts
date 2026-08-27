import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
  { workspace: '@ai-atomic-framework/cli', name: '@ai-atomic-framework/cli', bin: 'atm' },
  { workspace: 'create-atm', name: 'create-atm', bin: 'create-atm' }
] as const;

function fail(message: string): never {
  throw new Error(`[npm-clean-install] ${message}`);
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function assertAllowedFiles(entry: any): void {
  for (const file of entry.files ?? []) {
    const packedPath = String(file.path ?? '');
    if (packedPath === 'package.json' || packedPath === 'README.md' || packedPath.startsWith('dist/')) continue;
    fail(`${entry.name} packs disallowed path ${packedPath}`);
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-product-clean-install-'));
try {
  for (const packageSpec of packages) {
    const manifest = JSON.parse(readFileSync(path.join(root, 'packages', packageSpec.workspace === 'create-atm' ? 'create-atm' : 'cli', 'package.json'), 'utf8'));
    if (JSON.stringify(manifest.files) !== JSON.stringify(packageSpec.workspace === 'create-atm' ? ['dist', 'README.md'] : ['dist'])) {
      fail(`${packageSpec.workspace} files allowlist must contain runtime artifacts only`);
    }

  }

  const packed = JSON.parse(run('npm', ['pack', '--workspaces', '--pack-destination', tempRoot, '--json'], root));
  if (!Array.isArray(packed) || packed.length === 0) fail('npm pack did not return workspace artifacts');
  const byName = new Map(packed.map((entry: any) => [entry.name, entry]));
  for (const packageSpec of packages) {
    const entry = byName.get(packageSpec.name);
    if (!entry) fail(`missing packed artifact for ${packageSpec.workspace}`);
    assertAllowedFiles(entry);
  }
  const tarballs = packed.map((entry: any) => path.join(tempRoot, entry.filename));
  if (tarballs.some((tarball: string) => !existsSync(tarball))) fail('npm pack did not create every workspace tarball');
  const installRoot = path.join(tempRoot, 'clean-install');
  mkdirSync(installRoot, { recursive: true });
  run('npm', ['init', '--yes'], installRoot);
  run('npm', ['install', '--ignore-scripts', '--no-save', ...tarballs], installRoot);
  for (const packageSpec of packages) {
    const bin = process.platform === 'win32' ? `${packageSpec.bin}.cmd` : packageSpec.bin;
    const binPath = path.join(installRoot, 'node_modules', '.bin', bin);
    if (!existsSync(binPath)) fail(`installed ${packageSpec.workspace} does not expose ${packageSpec.bin}`);
    const help = spawnSync(binPath, ['--help'], { cwd: installRoot, encoding: 'utf8', shell: process.platform === 'win32' });
    const helpText = `${help.stdout ?? ''}${help.stderr ?? ''}`;
    if (packageSpec.workspace === 'create-atm') {
      if (help.status !== 0 && help.status !== 1) fail(`create-atm --help exited ${help.status}`);
      if (!helpText.includes('Usage: create-atm')) fail('create-atm did not expose its usage text after clean install');
    } else if (help.status !== 0) {
      fail(`${packageSpec.bin} --help failed: ${helpText}`);
    }
  }
  console.log('[npm-clean-install] ok (two packed packages install and expose their bins)');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
