import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.ts';
import { createTempWorkspace } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

// TASK-ASR-0010: scriptRoutes 從 wrappers.json SSoT 動態讀取，不再硬編碼
interface WrapperEntry {
  name: string;
  subcommand: string;
  extraArgs: string[];
  alwaysJson: boolean;
}
interface WrappersManifest {
  wrappers: WrapperEntry[];
}
const manifestPath = path.join(
  root,
  'templates',
  'root-drop',
  '.atm',
  'scripts',
  'wrappers.json'
);
const wrappersManifest: WrappersManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scriptRoutes: Record<string, readonly string[]> = Object.fromEntries(
  wrappersManifest.wrappers.map((w) => [
    w.name,
    [w.subcommand, ...w.extraArgs, ...(w.alwaysJson ? ['--json'] : [])],
  ])
);
const packageScripts = packageJson.scripts ?? {};

function fail(message: string) {
  console.error(`[script-parity:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function run(command: string, args: readonly string[], cwd: string, options: { readonly allowFailure?: boolean } = {}) {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8'
  });
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    fail(`${command} ${args.join(' ')} failed\nerror:\n${result.error?.message || ''}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  return result;
}

function parseShRoute(content: string) {
  const match = content.match(/exec node "\$REPO_ROOT\/atm\.mjs" ([^\r\n]+) "\$@"/);
  return match ? match[1].trim().split(/\s+/) : [];
}

function parsePowerShellRoute(content: string) {
  const match = content.match(/\) ([^\r\n]+) @args/);
  return match ? match[1].trim().split(/\s+/) : [];
}

function parseCliJson(result: any, label: string) {
  const payload = (result.stdout || result.stderr || '').trim();
  try {
    return JSON.parse(payload);
  } catch (error: any) {
    fail(`${label} did not emit JSON: ${payload || error.message}`);
    return {};
  }
}

assert(
  packageScripts['check:encoding:touched'] === 'node --strip-types scripts/check-encoding-touched.ts --mode touched',
  'package.json must expose check:encoding:touched for encoding-touched-guard'
);
assert(
  packageScripts['check:encoding:staged'] === 'node --strip-types scripts/check-encoding-touched.ts --mode staged',
  'package.json must expose check:encoding:staged for encoding-touched-guard'
);

for (const [scriptName, expectedRoute] of Object.entries(scriptRoutes)) {
  const shPath = path.join(root, 'templates', 'root-drop', '.atm', 'scripts', 'sh', `${scriptName}.sh`);
  const psPath = path.join(root, 'templates', 'root-drop', '.atm', 'scripts', 'ps', `${scriptName}.ps1`);
  assert(existsSync(shPath), `missing POSIX wrapper: ${scriptName}`);
  assert(existsSync(psPath), `missing PowerShell wrapper: ${scriptName}`);

  const shContent = readFileSync(shPath, 'utf8');
  const psContent = readFileSync(psPath, 'utf8');
  assert(JSON.stringify(parseShRoute(shContent)) === JSON.stringify(expectedRoute), `${scriptName}.sh route mismatch`);
  assert(JSON.stringify(parsePowerShellRoute(psContent)) === JSON.stringify(expectedRoute), `${scriptName}.ps1 route mismatch`);
  assert(!/function |if |case |while |for |foreach |switch /i.test(shContent), `${scriptName}.sh must stay a thin wrapper`);
  assert(!/function |if |case |while |for |foreach |switch /i.test(psContent), `${scriptName}.ps1 must stay a thin wrapper`);
}

const tempRoot = createTempWorkspace('atm-script-parity-');
try {
  const release = buildRootDropRelease({
    repositoryRoot: root,
    releaseRoot: path.join(tempRoot, 'release', 'atm-root-drop')
  });
  const bundleRepo = path.join(tempRoot, 'bundle-repo');
  mkdirSync(bundleRepo, { recursive: true });
  cpSync(release.releaseRoot, bundleRepo, { recursive: true });

  const initResult = run(process.execPath, ['atm.mjs', 'init', '--cwd', '.'], bundleRepo);
  const initJson = parseCliJson(initResult, 'root-drop init');
  assert(initJson.ok === true, 'root-drop init must pass before wrapper smoke');
  assert(existsSync(path.join(bundleRepo, '.atm', 'scripts', 'sh', 'atm-orient.sh')), 'init must write POSIX wrappers');
  assert(existsSync(path.join(bundleRepo, '.atm', 'scripts', 'ps', 'atm-orient.ps1')), 'init must write PowerShell wrappers');
  assert(Array.isArray(initJson.evidence?.scriptPaths) && initJson.evidence.scriptPaths.length === 14, 'init evidence must list all script wrappers');

  if (process.platform === 'win32') {
    const powerShellSmoke = run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.atm/scripts/ps/atm-orient.ps1'], bundleRepo);
    const powerShellJson = parseCliJson(powerShellSmoke, 'PowerShell wrapper smoke');
    assert(powerShellJson.ok === true, 'PowerShell orient wrapper must pass');
  }

  const shProbe = spawnSync('sh', ['-c', 'echo ok'], { cwd: bundleRepo, encoding: 'utf8' });
  if (!shProbe.error && shProbe.status === 0) {
    const shSmoke = run('sh', ['.atm/scripts/sh/atm-orient.sh'], bundleRepo);
    const shJson = parseCliJson(shSmoke, 'POSIX wrapper smoke');
    assert(shJson.ok === true, 'POSIX orient wrapper must pass');
  }

  const helloWorld = run(process.execPath, ['atm.mjs', 'test', '--atom', 'hello-world', '--json'], bundleRepo);
  const helloWorldJson = parseCliJson(helloWorld, 'hello-world smoke');
  assert(helloWorldJson.ok === true, 'root-drop hello-world smoke must pass after wrapper install');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[script-parity:${mode}] ok (7 POSIX + 7 PowerShell wrappers, init install, hello-world smoke)`);
}
