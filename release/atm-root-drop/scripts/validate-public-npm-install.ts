import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Args = { packageName: string; version: string; output?: string; recordBlocked: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const value = (name: string, fallback?: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const packageName = value('--package', '@ai-atomic-framework/cli');
  const version = value('--version', '0.1.0');
  if (!packageName || !version) throw new Error('--package and --version are required');
  return { packageName, version, output: value('--output'), recordBlocked: argv.includes('--record-blocked') };
}

function npmCommand() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }
function runNpm(args: string[], cwd?: string) {
  return execFileSync(npmCommand(), args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' });
}
function sha256(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
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
    metadata = JSON.parse(runNpm(['view', `${args.packageName}@${args.version}`, 'version', 'dist.tarball', 'dist.integrity', '_id', '--json']).trim());
  } catch (error) {
    const payload = report(args, { status: 'blocked', publicRegistry: false, temporaryRootRemoved: true, blockedReason: 'npm registry metadata lookup failed or package/version is not published', error: String(error) });
    console.log(JSON.stringify(payload));
    if (!args.recordBlocked) process.exitCode = 1;
    process.exit();
  }
  if (!metadata?.version || !metadata?.dist?.tarball) throw new Error('registry metadata is incomplete');
  root = mkdtempSync(join(tmpdir(), 'atm-public-npm-'));
  const packed = JSON.parse(runNpm(['pack', `${args.packageName}@${args.version}`, '--pack-destination', root, '--json', '--loglevel', 'silent'], root).trim());
  const filename = Array.isArray(packed) ? packed[0]?.filename : packed?.filename;
  if (!filename) throw new Error('npm pack returned no tarball');
  const tarball = join(root, filename);
  const consumer = join(root, 'consumer');
  runNpm(['install', '--ignore-scripts', '--prefix', consumer, `${args.packageName}@${args.version}`], root);
  const bin = process.platform === 'win32' ? join(consumer, 'node_modules', '.bin', 'atm.cmd') : join(consumer, 'node_modules', '.bin', 'atm');
  const cliVersion = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
  const payload = report(args, { status: 'verified', publicRegistry: true, registryVersion: metadata.version, distTarball: metadata.dist.tarball, distIntegrity: metadata.dist.integrity ?? null, tarballSha256: sha256(tarball), cliVersion, cleanConsumer: true, usedWorkspaceLink: false, temporaryRootRemoved: true });
  console.log(JSON.stringify(payload));
} catch (error) {
  const payload = report(args, { status: 'blocked', publicRegistry: false, temporaryRootRemoved: true, blockedReason: 'public clean-consumer install proof failed', error: String(error) });
  console.log(JSON.stringify(payload));
  process.exitCode = 1;
} finally {
  if (root) rmSync(root, { recursive: true, force: true });
}
