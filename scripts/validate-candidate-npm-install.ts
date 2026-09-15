import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

type Args = {
  candidateDir: string;
  candidateTarball?: string;
  output?: string;
  measurementRuns: number;
  recordBlocked: boolean;
};

type PackMetadata = {
  filename?: string;
  name?: string;
  version?: string;
  size?: number;
  unpackedSize?: number;
  files?: Array<{ path?: string; size?: number }>;
};

type DependencyFootprint = {
  nodeModulesBytes: number;
  nodeModulesFiles: number;
  nodeModulesEntries: number;
  packageJsonCount: number;
  semantics: string;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const value = (flag: string, fallback?: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const measurementRuns = Number(value('--measurement-runs', '1'));
  if (!Number.isInteger(measurementRuns) || measurementRuns < 1 || measurementRuns > 10) {
    throw new Error('--measurement-runs must be an integer from 1 to 10');
  }
  const candidateDir = path.resolve(value('--candidate-dir', path.join(root, 'packages', 'cli')) as string);
  const candidateTarball = value('--candidate-tarball');
  if (candidateTarball && !existsSync(path.resolve(candidateTarball))) {
    throw new Error(`candidate tarball does not exist: ${candidateTarball}`);
  }
  if (candidateTarball && !existsSync(candidateDir)) {
    throw new Error(`candidate directory does not exist: ${candidateDir}`);
  }
  return {
    candidateDir,
    candidateTarball: candidateTarball ? path.resolve(candidateTarball) : undefined,
    output: value('--output'),
    measurementRuns,
    recordBlocked: argv.includes('--record-blocked')
  };
}

function runNpm(args: string[], cwd: string): string {
  return execFileSync(npmCommand, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true
  });
}

function parsePackMetadata(raw: string): PackMetadata {
  const parsed = JSON.parse(raw.trim());
  const metadata = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!metadata?.filename || !Array.isArray(metadata.files)) {
    throw new Error('npm pack metadata is missing filename or files');
  }
  return metadata as PackMetadata;
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function tarField(buffer: Buffer, offset: number, length: number): string {
  return buffer.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/, '').trim();
}

function tarOctalField(buffer: Buffer, offset: number, length: number): number {
  const raw = tarField(buffer, offset, length).replace(/\0/g, '').trim();
  if (!raw) return 0;
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid tar entry size: ${raw}`);
  return value;
}

function readExplicitTarballMetadata(tarball: string): PackMetadata {
  const compressed = readFileSync(tarball);
  let archive: Buffer;
  try {
    archive = gunzipSync(compressed);
  } catch {
    throw new Error('candidate tarball is not a valid gzip archive');
  }
  const files: Array<{ path: string; size: number }> = [];
  let packageJson: string | undefined;
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarField(header, 0, 100);
    const prefix = tarField(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    if (!entryPath) throw new Error('candidate tarball contains an unnamed entry');
    const size = tarOctalField(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const contentOffset = offset + 512;
    const contentEnd = contentOffset + size;
    if (contentEnd > archive.length) throw new Error(`candidate tarball entry is truncated: ${entryPath}`);
    if (type === '0' || type === '\0') {
      files.push({ path: entryPath, size });
      if (entryPath === 'package/package.json') {
        packageJson = archive.subarray(contentOffset, contentEnd).toString('utf8');
      }
    }
    offset = contentOffset + Math.ceil(size / 512) * 512;
  }
  if (offset > archive.length || !packageJson) {
    throw new Error('candidate tarball is missing package/package.json');
  }
  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(packageJson) as { name?: unknown; version?: unknown };
  } catch {
    throw new Error('candidate tarball package/package.json is invalid JSON');
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || !manifest.name || !manifest.version) {
    throw new Error('candidate tarball package/package.json is missing name or version');
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    filename: path.basename(tarball),
    name: manifest.name,
    version: manifest.version,
    size: compressed.byteLength,
    unpackedSize: files.reduce((total, entry) => total + entry.size, 0),
    files
  };
}

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (index - lower);
}

function measureDependencyFootprint(consumer: string): DependencyFootprint {
  const nodeModules = path.join(consumer, 'node_modules');
  let nodeModulesBytes = 0;
  let nodeModulesFiles = 0;
  let nodeModulesEntries = 0;
  let packageJsonCount = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      nodeModulesEntries += 1;
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      const size = lstatSync(entryPath).size;
      nodeModulesBytes += size;
      nodeModulesFiles += 1;
      if (entry.name === 'package.json') packageJsonCount += 1;
    }
  };
  visit(nodeModules);
  return {
    nodeModulesBytes,
    nodeModulesFiles,
    nodeModulesEntries,
    packageJsonCount,
    semantics: 'sum of lstat file bytes under consumer/node_modules; directories excluded and symlinks counted as lstat entries'
  };
}

function packCandidate(args: Args, packRoot: string): { metadata: PackMetadata; tarball: string; source: string } {
  mkdirSync(packRoot, { recursive: true });
  if (args.candidateTarball) {
    const tarball = path.join(packRoot, path.basename(args.candidateTarball));
    writeFileSync(tarball, readFileSync(args.candidateTarball));
    return { metadata: readExplicitTarballMetadata(tarball), tarball, source: 'explicit-tarball' };
  }
  const metadata = parsePackMetadata(runNpm([
    'pack', args.candidateDir, '--ignore-scripts', '--pack-destination', packRoot, '--json', '--loglevel', 'silent'
  ], root));
  return { metadata, tarball: path.join(packRoot, metadata.filename as string), source: 'candidate-directory' };
}

type SmokeResult = {
  exitCode: number;
  moduleResolutionFailure: boolean;
  commandExecuted: boolean;
  startupMs: number[];
  p50Ms: number;
  p95Ms: number;
  outputSha256: string;
};

const legacySmokeCommandNames = ['version', 'doctor', 'next', 'tasks'] as const;
const coreWorkflowCommandNames = ['version', 'doctor', 'bootstrap', 'atm-chart-render', 'atm-chart-verify'] as const;
const candidateSmokeCommandNames = ['version', 'doctor', 'next', 'tasks', 'bootstrap', 'atm-chart-render', 'atm-chart-verify'] as const;

const smokeCommands = [
  ['version', '--version', '--json'],
  ['doctor', 'doctor', '--json'],
  ['next', 'next', '--json'],
  ['tasks', 'tasks', 'status', '--task', 'TASK-PRF-0050', '--json'],
  ['bootstrap', 'bootstrap', '--cwd', 'WORKFLOW_PLACEHOLDER', '--task', 'PUBLIC-CANDIDATE', '--json'],
  ['atm-chart-render', 'atm-chart', 'render', '--cwd', 'WORKFLOW_PLACEHOLDER', '--json'],
  ['atm-chart-verify', 'atm-chart', 'verify', '--cwd', 'WORKFLOW_PLACEHOLDER', '--json']
] as const;

function coreWorkflowFailures(smoke: Record<string, SmokeResult>): string[] {
  return coreWorkflowCommandNames.filter((name) => smoke[name]?.exitCode !== 0);
}

function runSmoke(tarball: string, tempRoot: string, runs: number): { installMs: number; smoke: Record<string, SmokeResult>; bin: string; dependencyFootprint: DependencyFootprint } {
  const consumer = path.join(tempRoot, 'consumer');
  const workflow = path.join(consumer, 'workflow');
  mkdirSync(workflow, { recursive: true });
  const installStart = performance.now();
  runNpm(['install', '--ignore-scripts', '--prefix', consumer, tarball], tempRoot);
  const installMs = performance.now() - installStart;
  const dependencyFootprint = measureDependencyFootprint(consumer);
  const bin = process.platform === 'win32'
    ? path.join(consumer, 'node_modules', '.bin', 'atm.cmd')
    : path.join(consumer, 'node_modules', '.bin', 'atm');
  if (!existsSync(bin)) throw new Error(`candidate install did not expose atm bin: ${bin}`);

  const smoke: Record<string, SmokeResult> = {};
  for (const [name, ...rawCommandArgs] of smokeCommands) {
    const commandArgs = rawCommandArgs.map((argument) => argument === 'WORKFLOW_PLACEHOLDER' ? workflow : argument);
    const startupMs: number[] = [];
    let result = spawnSync(bin, commandArgs, {
      cwd: consumer,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      windowsHide: true
    });
    // Measure the first invocation as well; additional repetitions are only
    // needed for the version command to keep the smoke lane inexpensive.
    startupMs.push(0);
    const repeatCount = name === 'version' ? runs : 1;
    for (let index = 0; index < repeatCount; index += 1) {
      const started = performance.now();
      result = spawnSync(bin, commandArgs, {
        cwd: consumer,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        windowsHide: true
      });
      startupMs.push(performance.now() - started);
    }
    startupMs.shift();
    const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const moduleResolutionFailure = /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module/i.test(combined);
    smoke[name] = {
      exitCode: result.status ?? 1,
      moduleResolutionFailure,
      commandExecuted: result.error === undefined,
      startupMs,
      p50Ms: percentile(startupMs, 0.5),
      p95Ms: percentile(startupMs, 0.95),
      outputSha256: createHash('sha256').update(combined).digest('hex')
    };
  }
  return { installMs, smoke, bin, dependencyFootprint };
}

function writeProof(args: Args, proof: Record<string, unknown>): void {
  if (args.output) {
    mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    writeFileSync(path.resolve(args.output), `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(proof));
}

const args = parseArgs();
const tempRoot = mkdtempSync(path.join(tmpdir(), 'atm-candidate-install-'));
try {
  const packed = packCandidate(args, path.join(tempRoot, 'pack'));
  const smokeRun = runSmoke(packed.tarball, tempRoot, args.measurementRuns);
  const files = packed.metadata.files ?? [];
  const moduleResolutionFailures = Object.values(smokeRun.smoke).filter((entry) => entry.moduleResolutionFailure).length;
  const commands = Object.keys(smokeRun.smoke);
  const requiredSuccessCommandFailures = coreWorkflowFailures(smokeRun.smoke);
  const allCommandsExecuted = Object.values(smokeRun.smoke).every((entry) => entry.commandExecuted);
  const commandMatrixComplete = commands.length === candidateSmokeCommandNames.length
    && candidateSmokeCommandNames.every((name) => commands.includes(name));
  const coreWorkflowPassed = requiredSuccessCommandFailures.length === 0;
  const candidate = {
    source: packed.source,
    sourceDir: args.candidateDir,
    version: packed.metadata.version ?? 'local',
    tarball: packed.tarball,
    tarballBytes: Number(packed.metadata.size ?? readFileSync(packed.tarball).byteLength),
    tarballSha256: sha256(packed.tarball),
    unpackedBytes: Number(packed.metadata.unpackedSize ?? 0),
    entryCount: files.length,
    files: files.map((entry) => ({ path: entry.path ?? '', size: entry.size ?? null })),
    installMs: smokeRun.installMs,
    dependencyFootprint: smokeRun.dependencyFootprint,
    smoke: smokeRun.smoke
  };
  const proof: Record<string, unknown> = {
    schemaId: 'atm.candidateNpmInstallProof.v1',
    generatedAt: new Date().toISOString(),
    candidate,
    validation: {
      cleanConsumer: true,
      usedWorkspaceLink: false,
      commandMatrix: commands,
      commandMatrixComplete,
      versionOnlySmoke: false,
      moduleResolutionFailures,
      allCommandsExecuted,
      requiredSuccessCommands: [...coreWorkflowCommandNames],
      requiredSuccessCommandFailures,
      coreWorkflowPassed,
      candidateOnly: true,
      publicRegistry: false,
      passed: commandMatrixComplete
        && moduleResolutionFailures === 0
        && allCommandsExecuted
        && coreWorkflowPassed
    },
    measurement: {
      hostPlatform: process.platform,
      nodeVersion: process.version,
      runs: args.measurementRuns
    },
    temporaryRootRemoved: true
  };
  writeProof(args, proof);
  if (!(proof.validation as { passed: boolean }).passed) process.exitCode = 1;
} catch (error) {
  const proof = {
    schemaId: 'atm.candidateNpmInstallProof.v1',
    generatedAt: new Date().toISOString(),
    validation: {
      cleanConsumer: false,
      usedWorkspaceLink: false,
      commandMatrix: smokeCommands.map(([name]) => name),
      commandMatrixComplete: false,
      versionOnlySmoke: false,
      requiredSuccessCommands: [...coreWorkflowCommandNames],
      requiredSuccessCommandFailures: [...coreWorkflowCommandNames],
      coreWorkflowPassed: false,
      candidateOnly: true,
      publicRegistry: false,
      passed: false
    },
    status: args.recordBlocked ? 'blocked' : 'failed',
    error: String(error),
    temporaryRootRemoved: true
  };
  writeProof(args, proof);
  if (!args.recordBlocked) process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
