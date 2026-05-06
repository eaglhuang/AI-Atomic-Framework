import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const requiredFiles = [
  'templates/root-drop/AGENTS.md',
  'templates/root-drop/.atm/profile/default.md',
  'templates/root-drop/.atm/context/INITIAL_SUMMARY.md',
  'examples/agent-bootstrap/README.md',
  'examples/agent-bootstrap/static-site-host/README.md',
  'examples/agent-bootstrap/static-site-host/index.html',
  'examples/agent-bootstrap/static-site-host/assets/css/site.css',
  'packages/cli/src/commands/bootstrap.mjs'
];

const protectedSurfaceFiles = [
  'README.md',
  'examples/agent-bootstrap/README.md',
  'templates/root-drop/AGENTS.md',
  'templates/root-drop/.atm/profile/default.md',
  'templates/root-drop/.atm/context/INITIAL_SUMMARY.md'
];

const bannedTerms = [
  '3KLife',
  'Cocos',
  'cocos-creator',
  'html-to-ucuf',
  'gacha',
  'UCUF',
  'draft-builder',
  'task-lock',
  'compute-gate',
  'doc-id-registry',
  'tools_node/',
  'assets/scripts/',
  'docs/agent-briefs/'
];

function fail(message) {
  console.error(`[bootstrap:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(absolutePath) {
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function runAtm(args, cwd) {
  const result = spawnSync(process.execPath, [path.join(root, 'packages/cli/src/atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
    parsed = {};
  }
  return {
    exitCode: result.status ?? 0,
    parsed,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

for (const relativePath of requiredFiles) {
  assert(existsSync(path.join(root, relativePath)), `missing bootstrap file: ${relativePath}`);
}

for (const relativePath of protectedSurfaceFiles) {
  const content = readFileSync(path.join(root, relativePath), 'utf8');
  for (const term of bannedTerms) {
    assert(!content.includes(term), `${relativePath} contains downstream-only term: ${term}`);
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-bootstrap-'));
try {
  const hostRepo = path.join(tempRoot, 'static-site-host');
  mkdirSync(path.join(hostRepo, '.git'), { recursive: true });
  mkdirSync(path.join(hostRepo, 'articles'), { recursive: true });
  mkdirSync(path.join(hostRepo, 'assets', 'css'), { recursive: true });
  writeFileSync(path.join(hostRepo, 'README.md'), '# Host Site\n\nStatic host repository for ATM bootstrap validation.\n', 'utf8');
  writeFileSync(path.join(hostRepo, 'index.html'), '<!doctype html><html><body><h1>Host</h1></body></html>\n', 'utf8');
  writeFileSync(path.join(hostRepo, 'articles', 'index.html'), '<!doctype html><html><body><p>Article list</p></body></html>\n', 'utf8');
  writeFileSync(path.join(hostRepo, 'assets', 'css', 'site.css'), 'body { font-family: serif; }\n', 'utf8');

  const init = runAtm(['init', '--cwd', hostRepo, '--adopt', 'default', '--task', 'Bootstrap static site'], hostRepo);
  assert(init.exitCode === 0, 'init --adopt default must exit 0');
  assert(init.parsed.ok === true, 'init --adopt default must report ok=true');
  assert(init.parsed.evidence.adoptedProfile === 'default', 'init must report adoptedProfile=default');

  for (const relativePath of [
    'AGENTS.md',
    '.atm/config.json',
    '.atm/profile/default.md',
    '.atm/context/INITIAL_SUMMARY.md',
    '.atm/state/project-probe.json',
    '.atm/state/default-guards.json',
    '.atm/tasks/BOOTSTRAP-0001.json',
    '.atm/locks/BOOTSTRAP-0001.lock.json',
    '.atm/evidence/BOOTSTRAP-0001.json',
    '.atm/artifacts',
    '.atm/logs',
    '.atm/reports'
  ]) {
    assert(existsSync(path.join(hostRepo, relativePath)), `bootstrap must create ${relativePath}`);
  }

  const probe = readJson(path.join(hostRepo, '.atm', 'state', 'project-probe.json'));
  assert(probe.repositoryKind === 'static-site', 'project probe must detect static-site repository kind');
  assert(probe.packageManager === 'none', 'project probe must keep packageManager=none for static site');
  assert(probe.hostWorkflow === 'file-publish', 'project probe must report file-publish host workflow');

  const guards = readJson(path.join(hostRepo, '.atm', 'state', 'default-guards.json'));
  assert(Array.isArray(guards.guards) && guards.guards.length === 3, 'default guards must contain 3 starter guards');

  const agents = readFileSync(path.join(hostRepo, 'AGENTS.md'), 'utf8');
  assert(agents.includes('.atm/tasks/BOOTSTRAP-0001.json'), 'AGENTS.md must point to bootstrap task');
  assert(agents.includes('Read README.md if present'), 'AGENTS.md must contain the one-line kickoff prompt');

  const status = runAtm(['status', '--cwd', hostRepo], hostRepo);
  assert(status.exitCode === 0, 'status after adopt must exit 0');
  assert(status.parsed.ok === true, 'status after adopt must report ok=true');
  assert(status.parsed.evidence.adoptedProfile === 'default', 'status must report adoptedProfile=default');
  assert(status.parsed.evidence.repositoryKind === 'static-site', 'status must surface repositoryKind from project probe');

  const validate = runAtm(['validate', '--cwd', hostRepo], hostRepo);
  assert(validate.exitCode === 0, 'validate after adopt must exit 0');
  assert(validate.parsed.ok === true, 'validate after adopt must report ok=true');

  const secondInit = runAtm(['init', '--cwd', hostRepo, '--adopt', 'default'], hostRepo);
  assert(secondInit.exitCode === 0, 'second init must still exit 0');
  assert(secondInit.parsed.ok === true, 'second init must report ok=true');
  assert(Array.isArray(secondInit.parsed.evidence.unchanged), 'second init must report unchanged files');
  assert(secondInit.parsed.evidence.unchanged.includes('AGENTS.md'), 'second init must leave AGENTS.md unchanged without --force');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[bootstrap:' + mode + '] ok (default adopt, static-site probe, and one-line kickoff verified)');
}