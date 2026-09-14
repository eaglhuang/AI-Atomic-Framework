import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

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

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (index - lower);
}

function packCandidate(args: Args, packRoot: string): { metadata: PackMetadata; tarball: string; source: string } {
  mkdirSync(packRoot, { recursive: true });
  if (args.candidateTarball) {
    const tarball = path.join(packRoot, path.basename(args.candidateTarball));
    writeFileSync(tarball, readFileSync(args.candidateTarball));
    return { metadata: { filename: path.basename(tarball), files: [] }, tarball, source: 'explicit-tarball' };
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

const smokeCommands = [
  ['version', '--version', '--json'],
  ['next', 'next', '--json'],
  ['tasks', 'tasks', 'status', '--task', 'TASK-PRF-0050', '--json'],
  ['doctor', 'doctor', '--json']
] as const;

function runSmoke(tarball: string, tempRoot: string, runs: number): { installMs: number; smoke: Record<string, SmokeResult>; bin: string } {
  const consumer = path.join(tempRoot, 'consumer');
  const installStart = performance.now();
  runNpm(['install', '--ignore-scripts', '--prefix', consumer, tarball], tempRoot);
  const installMs = performance.now() - installStart;
  const bin = process.platform === 'win32'
    ? path.join(consumer, 'node_modules', '.bin', 'atm.cmd')
    : path.join(consumer, 'node_modules', '.bin', 'atm');
  if (!existsSync(bin)) throw new Error(`candidate install did not expose atm bin: ${bin}`);

  const smoke: Record<string, SmokeResult> = {};
  for (const [name, ...commandArgs] of smokeCommands) {
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
  return { installMs, smoke, bin };
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
      commandMatrixComplete: commands.length === smokeCommands.length,
      versionOnlySmoke: false,
      moduleResolutionFailures,
      allCommandsExecuted: Object.values(smokeRun.smoke).every((entry) => entry.commandExecuted),
      passed: commands.length === smokeCommands.length
        && moduleResolutionFailures === 0
        && Object.values(smokeRun.smoke).every((entry) => entry.commandExecuted)
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
