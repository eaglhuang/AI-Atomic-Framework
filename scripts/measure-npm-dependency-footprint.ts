// Measure the full installed footprint of published CLI versions: clean-install
// each version from the public registry and sum node_modules on disk, separating
// the CLI package itself from transitive dependencies. Tarball and unpacked size
// alone cannot show cost moved into extra downloads (0.1.0-beta.1 unpacked to
// 4.66 MB but installed 31 MB because it pulled typescript at runtime).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function walk(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = walk(full);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      bytes += statSync(full).size;
      files += 1;
    }
  }
  return { bytes, files };
}

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const packageIndex = args.indexOf('--package');
const packageName = packageIndex >= 0 ? args[packageIndex + 1] : '@ai-atomic-framework/cli';
const versions = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--output' && args[index - 1] !== '--package');
if (versions.length === 0) {
  console.error('usage: node --strip-types scripts/measure-npm-dependency-footprint.ts <version...> [--package <name>] [--output <file.json>]');
  process.exit(2);
}

const results: Array<Record<string, unknown>> = [];
for (const version of versions) {
  const root = mkdtempSync(path.join(tmpdir(), 'atm-footprint-'));
  try {
    const started = Date.now();
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--prefix', root, `${packageName}@${version}`],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', windowsHide: true });
    const installMs = Date.now() - started;
    const nodeModules = path.join(root, 'node_modules');
    const total = walk(nodeModules);
    const own = walk(path.join(nodeModules, ...packageName.split('/')));
    const scope = packageName.startsWith('@') ? packageName.split('/')[0] : null;
    const transitivePackages = readdirSync(nodeModules, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '.bin' && entry.name !== scope && entry.name !== packageName)
      .map((entry) => entry.name);
    results.push({
      version, installMs, nodeModulesBytes: total.bytes, nodeModulesFiles: total.files,
      packageBytes: own.bytes, packageFiles: own.files, transitiveBytes: total.bytes - own.bytes, transitivePackages,
    });
    console.log(`${version}: node_modules ${total.bytes} bytes / ${total.files} files; package ${own.bytes} bytes; transitive packages ${transitivePackages.length}`);
  } catch (error) {
    results.push({ version, error: String(error).slice(0, 400) });
    console.log(`${version}: install failed`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const report = { schemaId: 'atm.dependencyFootprintMeasurement.v1', measuredAt: new Date().toISOString(), packageName, platform: process.platform, nodeVersion: process.version, results };
if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.exitCode = results.some((result) => 'error' in result) ? 1 : 0;
