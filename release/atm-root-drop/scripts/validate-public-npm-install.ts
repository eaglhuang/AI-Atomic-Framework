import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

type Args = {
  packageName: string;
  version: string;
  output?: string;
  recordBlocked: boolean;
  requireDefaultTag: boolean;
  measure: boolean;
  candidateDir: string;
  baselineVersion?: string;
  measurementOutput?: string;
  measurementRuns: number;
};

type ArtifactBudget = { maxPackedBytes: number; maxPackedEntries: number };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const value = (name: string, fallback?: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const packageName = value('--package', '@ai-atomic-framework/cli');
  if (!packageName) throw new Error('--package is required');
  const version = value('--version') ?? resolvePublishedLatest(packageName);
  const measurementRuns = Number(value('--measurement-runs', '3'));
  if (!Number.isInteger(measurementRuns) || measurementRuns < 1 || measurementRuns > 10) {
    throw new Error('--measurement-runs must be an integer from 1 to 10');
  }
  return {
    packageName,
    version,
    output: value('--output'),
    recordBlocked: argv.includes('--record-blocked'),
    requireDefaultTag: argv.includes('--require-default-tag'),
    measure: argv.includes('--measure'),
    candidateDir: resolve(value('--candidate-dir', join('packages', 'cli')) as string),
    baselineVersion: value('--baseline-version'),
    measurementOutput: value('--measurement-output'),
    measurementRuns,
  };
}

function resolvePublishedLatest(packageName: string): string {
  const latest = runNpm(['view', packageName, 'dist-tags.latest', '--json']).trim().replace(/^\"|\"$/g, '');
  if (!latest) throw new Error(`npm latest dist-tag is unavailable for ${packageName}; pass --version explicitly`);
  return latest;
}

function npmCommand() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }
function runNpm(args: string[], cwd?: string) {
  return execFileSync(npmCommand(), args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' });
}
function sha256(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function loadArtifactBudget(packageName: string): ArtifactBudget | null {
  if (packageName !== '@ai-atomic-framework/cli') return null;
  const manifestPath = join(process.cwd(), 'packages', 'cli', 'package.json');
  if (!existsSync(manifestPath)) throw new Error(`artifact budget manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { atmArtifactBudget?: { schemaId?: string; budget?: Partial<ArtifactBudget> } };
  const budget = manifest.atmArtifactBudget?.budget;
  if (manifest.atmArtifactBudget?.schemaId !== 'atm.cliArtifactBudget.v1'
    || !Number.isInteger(budget?.maxPackedBytes) || !Number.isInteger(budget?.maxPackedEntries)) {
    throw new Error('CLI artifact budget is missing or malformed');
  }
  const maxPackedBytes = budget?.maxPackedBytes;
  const maxPackedEntries = budget?.maxPackedEntries;
  return { maxPackedBytes: maxPackedBytes as number, maxPackedEntries: maxPackedEntries as number };
}
function report(args: Args, result: Record<string, unknown>) {
  const payload: Record<string, unknown> = { schemaId: 'atm.publicNpmInstallProof.v1', package: args.packageName, version: args.version, registry: 'https://registry.npmjs.org', ...result };
  if (args.output) {
    const status = payload.status === 'verified' ? 'VERIFIED' : 'BLOCKED / INCONCLUSIVE';
    writeFileSync(args.output, ['# Public npm install proof', '', `- Status: **${status}**`, `- Package: \`${args.packageName}@${args.version}\``, '- Registry: https://registry.npmjs.org', '', '```json', JSON.stringify(payload, null, 2), '```', ''].join('\n'), 'utf8');
  }
  return payload;
}

type PackMetadata = {
  name?: string;
  version?: string;
  size?: number;
  unpackedSize?: number;
  filename?: string;
  files?: unknown[];
};

function parsePackResult(raw: string): PackMetadata {
  const parsed = JSON.parse(raw.trim());
  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!result?.filename || !Number.isFinite(Number(result.unpackedSize)) || !Array.isArray(result.files)) {
    throw new Error('npm pack metadata is missing filename, unpackedSize, or files');
  }
  return result as PackMetadata;
}

function pack(spec: string, destination: string, cwd?: string): { metadata: PackMetadata; tarball: string } {
  mkdirSync(destination, { recursive: true });
  const metadata = parsePackResult(runNpm(['pack', spec, '--ignore-scripts', '--pack-destination', destination, '--json', '--loglevel', 'silent'], cwd));
  return { metadata, tarball: join(destination, metadata.filename as string) };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function runSmoke(tarball: string, root: string, label: string, runs: number) {
  const consumer = join(root, `${label}-consumer`);
  const installStarted = performance.now();
  runNpm(['install', '--ignore-scripts', '--prefix', consumer, tarball], root);
  const installMs = performance.now() - installStarted;
  const bin = process.platform === 'win32'
    ? join(consumer, 'node_modules', '.bin', 'atm.cmd')
    : join(consumer, 'node_modules', '.bin', 'atm');
  const commands = [
    ['version', '--version', '--json'],
    ['doctor', 'doctor', '--json'],
    ['next', 'next', '--json'],
    ['tasks', 'tasks', 'status', '--task', 'TASK-PRF-0049', '--json'],
  ] as const;
  const smoke: Record<string, unknown> = {};
  for (const [name, ...argv] of commands) {
    const commandRuns: number[] = [];
    let exitCode = 0;
    let combined = '';
    for (let i = 0; i < (name === 'version' ? runs : 1); i += 1) {
      const started = performance.now();
      const result = spawnSync(bin, argv, { cwd: consumer, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
      commandRuns.push(performance.now() - started);
      exitCode = result.status ?? 1;
      combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    }
    const failure = combined.includes('ERR_MODULE_NOT_FOUND') || combined.includes('Cannot find module');
    smoke[name] = { exitCode, moduleResolutionFailure: failure, startupMs: commandRuns, p50Ms: percentile(commandRuns, 0.5), p95Ms: percentile(commandRuns, 0.95) };
  }
  return { installMs, smoke };
}

function runMeasurement(args: Args): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), 'atm-public-measure-'));
  try {
    const baselineVersion = args.baselineVersion ?? args.version;
    const baseline = pack(`${args.packageName}@${baselineVersion}`, join(root, 'baseline'));
    const candidate = pack(args.candidateDir, join(root, 'candidate'), process.cwd());
    const baselineBytes = Number(baseline.metadata.unpackedSize);
    const candidateBytes = Number(candidate.metadata.unpackedSize);
    const baselineEntries = baseline.metadata.files?.length ?? 0;
    const candidateEntries = candidate.metadata.files?.length ?? 0;
    const baselineRun = runSmoke(baseline.tarball, root, 'baseline', args.measurementRuns);
    const candidateRun = runSmoke(candidate.tarball, root, 'candidate', args.measurementRuns);
    const byteReduction = ((baselineBytes - candidateBytes) / baselineBytes) * 100;
    const entryReduction = ((baselineEntries - candidateEntries) / baselineEntries) * 100;
    const candidateFailures = Object.values(candidateRun.smoke as Record<string, { moduleResolutionFailure: boolean }>).filter((x) => x.moduleResolutionFailure).length;
    const smokeBehaviorMatchesBaseline = Object.keys(baselineRun.smoke as Record<string, { exitCode: number }>).every((name) => {
      const baselineResult = (baselineRun.smoke as Record<string, { exitCode: number }>)[name];
      const candidateResult = (candidateRun.smoke as Record<string, { exitCode: number }>)[name];
      return candidateResult && candidateResult.exitCode === baselineResult.exitCode;
    });
    const receipt: Record<string, unknown> = {
      schemaId: 'atm.baselineCandidateMeasurement.v1',
      generatedAt: new Date().toISOString(),
      package: args.packageName,
      baseline: { version: baseline.metadata.version ?? baselineVersion, unpackedBytes: baselineBytes, entryCount: baselineEntries, tarballBytes: Number(baseline.metadata.size), tarballSha256: sha256(baseline.tarball), ...baselineRun },
      candidate: { version: candidate.metadata.version ?? 'local', sourceDir: args.candidateDir, unpackedBytes: candidateBytes, entryCount: candidateEntries, tarballBytes: Number(candidate.metadata.size), tarballSha256: sha256(candidate.tarball), ...candidateRun },
      delta: { unpackedBytes: candidateBytes - baselineBytes, unpackedBytesReductionPercent: byteReduction, entryCount: candidateEntries - baselineEntries, entryCountReductionPercent: entryReduction },
      acceptance: { minUnpackedBytesReductionPercent: 20, minEntryReductionPercent: 15, unpackedBytesPassed: byteReduction >= 20, entryCountPassed: entryReduction >= 15, candidateCommandsFreeOfModuleResolutionFailure: candidateFailures === 0, smokeBehaviorMatchesBaseline, passed: byteReduction >= 20 && entryReduction >= 15 && candidateFailures === 0 && smokeBehaviorMatchesBaseline },
      measurement: { hostPlatform: process.platform, nodeVersion: process.version, runs: args.measurementRuns, baselineVersion, candidateDir: args.candidateDir },
    };
    if (args.measurementOutput) writeFileSync(args.measurementOutput, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(receipt));
    if (!(receipt.acceptance as { passed: boolean }).passed) process.exitCode = 1;
    return receipt;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const args = parseArgs();
if (args.measure) {
  try {
    runMeasurement(args);
  } catch (error) {
    console.error(JSON.stringify({ schemaId: 'atm.baselineCandidateMeasurement.v1', status: 'blocked', error: String(error) }));
    process.exitCode = args.recordBlocked ? 0 : 1;
  }
  process.exit();
}
let root: string | undefined;
try {
  let metadata: any;
  let distTags: any;
  try {
    metadata = JSON.parse(runNpm(['view', `${args.packageName}@${args.version}`, 'version', 'dist.tarball', 'dist.integrity', 'dist.unpackedSize', 'dist.fileCount', '_id', '--json']).trim());
    distTags = JSON.parse(runNpm(['view', args.packageName, 'dist-tags', '--json']).trim());
  } catch (error) {
    const payload = report(args, { status: 'blocked', publicRegistry: false, temporaryRootRemoved: true, blockedReason: 'npm registry metadata lookup failed or package/version is not published', error: String(error) });
    console.log(JSON.stringify(payload));
    if (!args.recordBlocked) process.exitCode = 1;
    process.exit();
  }
  const registryTarball = metadata?.dist?.tarball ?? metadata?.['dist.tarball'];
  const latestVersion = distTags?.latest ?? null;
  if (args.requireDefaultTag && latestVersion !== args.version) throw new Error(`default latest dist-tag resolves to ${latestVersion ?? 'unknown'}, not ${args.version}`);
  const registryIntegrity = metadata?.dist?.integrity ?? metadata?.['dist.integrity'] ?? null;
  const registryUnpackedSize = Number(metadata?.dist?.unpackedSize ?? metadata?.['dist.unpackedSize']);
  const registryFileCount = Number(metadata?.dist?.fileCount ?? metadata?.['dist.fileCount']);
  const budget = loadArtifactBudget(args.packageName);
  if (!metadata?.version || !registryTarball) throw new Error('registry metadata is incomplete');
  if (budget && (!Number.isFinite(registryUnpackedSize) || !Number.isFinite(registryFileCount))) {
    throw new Error('registry metadata is missing dist.unpackedSize or dist.fileCount required by the sealed artifact budget');
  }
  if (budget && registryUnpackedSize > budget.maxPackedBytes) {
    throw new Error(`public tarball exceeds artifact byte budget: ${registryUnpackedSize}/${budget.maxPackedBytes} unpacked bytes`);
  }
  if (budget && registryFileCount > budget.maxPackedEntries) {
    throw new Error(`public tarball exceeds artifact entry budget: ${registryFileCount}/${budget.maxPackedEntries} files`);
  }
  root = mkdtempSync(join(tmpdir(), 'atm-public-npm-'));
  const packed = JSON.parse(runNpm(['pack', `${args.packageName}@${args.version}`, '--pack-destination', root, '--json', '--loglevel', 'silent'], root).trim());
  const filename = Array.isArray(packed) ? packed[0]?.filename : packed?.filename;
  if (!filename) throw new Error('npm pack returned no tarball');
  const tarball = join(root, filename);
  const consumer = join(root, 'consumer');
  runNpm(['install', '--ignore-scripts', '--prefix', consumer, `${args.packageName}@${args.version}`], root);
  const bin = process.platform === 'win32' ? join(consumer, 'node_modules', '.bin', 'atm.cmd') : join(consumer, 'node_modules', '.bin', 'atm');
  const cliVersion = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }).trim();
  const payload = report(args, { status: 'verified', publicRegistry: true, registryVersion: metadata.version, defaultInstallVersion: latestVersion, defaultInstallMatchesRequested: latestVersion === args.version, distTarball: registryTarball, distIntegrity: registryIntegrity, registryUnpackedSize: Number.isFinite(registryUnpackedSize) ? registryUnpackedSize : null, registryFileCount: Number.isFinite(registryFileCount) ? registryFileCount : null, artifactBudget: budget, tarballSha256: sha256(tarball), cliVersion, cleanConsumer: true, usedWorkspaceLink: false, temporaryRootRemoved: true });
  console.log(JSON.stringify(payload));
} catch (error) {
  const payload = report(args, { status: 'blocked', publicRegistry: false, temporaryRootRemoved: true, blockedReason: 'public clean-consumer install proof failed', error: String(error) });
  console.log(JSON.stringify(payload));
  process.exitCode = args.recordBlocked ? 0 : 1;
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}
