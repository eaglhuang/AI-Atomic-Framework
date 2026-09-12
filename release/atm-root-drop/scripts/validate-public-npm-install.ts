import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Args = { packageName: string; version: string; output?: string; recordBlocked: boolean };

type ArtifactBudget = { maxPackedBytes: number; maxPackedEntries: number };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const value = (name: string, fallback?: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const packageName = value('--package', '@ai-atomic-framework/cli');
  // The framework source manifests retain the next stable train version, but
  // the public CLI is currently released from the beta train. Keep the
  // default aligned with the latest published package so a bare validator
  // invocation exercises the real registry artifact instead of an unpublished
  // placeholder version.
  const version = value('--version', '0.1.0-beta.5');
  if (!packageName || !version) throw new Error('--package and --version are required');
  return { packageName, version, output: value('--output'), recordBlocked: argv.includes('--record-blocked') };
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

const args = parseArgs();
let root: string | undefined;
try {
  let metadata: any;
  try {
    metadata = JSON.parse(runNpm(['view', `${args.packageName}@${args.version}`, 'version', 'dist.tarball', 'dist.integrity', 'dist.unpackedSize', 'dist.fileCount', '_id', '--json']).trim());
  } catch (error) {
    const payload = report(args, { status: 'blocked', publicRegistry: false, temporaryRootRemoved: true, blockedReason: 'npm registry metadata lookup failed or package/version is not published', error: String(error) });
    console.log(JSON.stringify(payload));
    if (!args.recordBlocked) process.exitCode = 1;
    process.exit();
  }
  const registryTarball = metadata?.dist?.tarball ?? metadata?.['dist.tarball'];
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
  const payload = report(args, { status: 'verified', publicRegistry: true, registryVersion: metadata.version, distTarball: registryTarball, distIntegrity: registryIntegrity, registryUnpackedSize: Number.isFinite(registryUnpackedSize) ? registryUnpackedSize : null, registryFileCount: Number.isFinite(registryFileCount) ? registryFileCount : null, artifactBudget: budget, tarballSha256: sha256(tarball), cliVersion, cleanConsumer: true, usedWorkspaceLink: false, temporaryRootRemoved: true });
  console.log(JSON.stringify(payload));
} catch (error) {
  const payload = report(args, { status: 'blocked', publicRegistry: false, temporaryRootRemoved: true, blockedReason: 'public clean-consumer install proof failed', error: String(error) });
  console.log(JSON.stringify(payload));
  process.exitCode = args.recordBlocked ? 0 : 1;
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}
