import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  const firstEncodingProbe = path.join(tempRoot, 'encoding-first.ts');
  const secondEncodingProbe = path.join(tempRoot, 'encoding-second.ts');
  cpSync(path.join(root, 'scripts', 'check-encoding-touched.ts'), path.join(tempRoot, 'check-encoding-touched.ts'));
  cpSync(path.join(root, 'atm.mjs'), path.join(tempRoot, 'atm.mjs'));
  cpSync(path.join(root, 'release'), path.join(tempRoot, 'release'), { recursive: true });
  mkdirSync(path.join(tempRoot, 'packages'), { recursive: true });
  cpSync(path.join(root, 'packages', 'cli'), path.join(tempRoot, 'packages', 'cli'), { recursive: true });
  cpSync(path.join(root, 'packages', 'core'), path.join(tempRoot, 'packages', 'core'), { recursive: true });
  cpSync(path.join(root, 'packages', 'plugin-governance-local'), path.join(tempRoot, 'packages', 'plugin-governance-local'), { recursive: true });
  cpSync(path.join(root, 'packages', 'adapter-local-git'), path.join(tempRoot, 'packages', 'adapter-local-git'), { recursive: true });
  cpSync(path.join(root, 'packages', 'language-js'), path.join(tempRoot, 'packages', 'language-js'), { recursive: true });
  cpSync(path.join(root, 'schemas'), path.join(tempRoot, 'schemas'), { recursive: true });
  cpSync(path.join(root, 'atomic-registry.json'), path.join(tempRoot, 'atomic-registry.json'));
  cpSync(path.join(root, 'package.json'), path.join(tempRoot, 'package.json'));
  cpSync(path.join(root, 'tsconfig.json'), path.join(tempRoot, 'tsconfig.json'));
  cpSync(path.join(root, 'tsconfig.build.json'), path.join(tempRoot, 'tsconfig.build.json'));
  mkdirSync(path.dirname(firstEncodingProbe), { recursive: true });
  cpSync(path.join(root, 'README.md'), firstEncodingProbe);
  cpSync(path.join(root, 'README.md'), secondEncodingProbe);
  const encodingProbe = run(process.execPath, [
    '--strip-types',
    'check-encoding-touched.ts',
    '--mode',
    'touched',
    '--files',
    'encoding-first.ts',
    'encoding-second.ts'
  ], tempRoot);
  const encodingJson = parseCliJson(encodingProbe, 'encoding touched multi-file probe');
  const encodedFiles = encodingJson.evidence?.files ?? [];
  assert(Array.isArray(encodedFiles) && encodedFiles.includes('encoding-first.ts') && encodedFiles.includes('encoding-second.ts'), 'encoding touched probe must report every explicit --files token');

  run('git', ['init'], tempRoot);
  writeFileSync(path.join(tempRoot, '.git', 'info', 'exclude'), '*\n!src/\n!src/**\n!tmp/\n!tmp/**\n', 'utf8');
  mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
  writeFileSync(path.join(tempRoot, 'src', 'clean-untracked.ts'), 'export const clean = true;\n', 'utf8');
  mkdirSync(path.join(tempRoot, 'tmp'), { recursive: true });
  const replacementChar = String.fromCharCode(0xfffd);
  writeFileSync(path.join(tempRoot, 'tmp', 'foreign-transcript.json'), `{"note":"bad replacement char: ${replacementChar}"}\n`, 'utf8');
  const touchedWithTempArtifact = run(process.execPath, [
    '--strip-types',
    'check-encoding-touched.ts',
    '--mode',
    'touched'
  ], tempRoot);
  const touchedWithTempJson = parseCliJson(touchedWithTempArtifact, 'encoding touched temp artifact isolation probe');
  const touchedFiles = touchedWithTempJson.evidence?.files ?? [];
  assert(touchedWithTempJson.ok === true, 'touched encoding guard must ignore untracked tmp diagnostic artifacts by default');
  assert(Array.isArray(touchedFiles) && touchedFiles.includes('src/clean-untracked.ts'), 'touched encoding guard must still scan normal untracked text files');
  assert(Array.isArray(touchedFiles) && !touchedFiles.includes('tmp/foreign-transcript.json'), 'touched encoding guard must not report isolated tmp artifacts in default scan');

  const explicitTempArtifact = run(process.execPath, [
    '--strip-types',
    'check-encoding-touched.ts',
    '--mode',
    'touched',
    '--files',
    'tmp/foreign-transcript.json'
  ], tempRoot, { allowFailure: true });
  const explicitTempJson = parseCliJson(explicitTempArtifact, 'encoding touched explicit temp artifact probe');
  assert(explicitTempArtifact.status === 1 && explicitTempJson.ok === false, 'explicit tmp artifact encoding checks must still fail closed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[script-parity:${mode}] ok (7 POSIX + 7 PowerShell wrappers, init install, hello-world smoke)`);
}
