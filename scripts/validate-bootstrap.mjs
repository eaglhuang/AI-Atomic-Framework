import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from './temp-root.mjs';

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
  'packages/cli/src/commands/bootstrap.mjs',
  'packages/cli/src/commands/bootstrap-entry.mjs'
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
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
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

const tempRoot = createTempWorkspace('atm-bootstrap-');
try {
  const hostRepo = path.join(tempRoot, 'static-site-host');
  mkdirSync(path.join(hostRepo, '.git'), { recursive: true });
  mkdirSync(path.join(hostRepo, 'articles'), { recursive: true });
  mkdirSync(path.join(hostRepo, 'assets', 'css'), { recursive: true });
  writeFileSync(path.join(hostRepo, 'README.md'), '# Host Site\n\nStatic host repository for ATM bootstrap validation.\n', 'utf8');
  writeFileSync(path.join(hostRepo, 'index.html'), '<!doctype html><html><body><h1>Host</h1></body></html>\n', 'utf8');
  writeFileSync(path.join(hostRepo, 'articles', 'index.html'), '<!doctype html><html><body><p>Article list</p></body></html>\n', 'utf8');
  writeFileSync(path.join(hostRepo, 'assets', 'css', 'site.css'), 'body { font-family: serif; }\n', 'utf8');

  const bootstrap = runAtm(['bootstrap', '--cwd', hostRepo, '--task', 'Bootstrap static site'], hostRepo);
  assert(bootstrap.exitCode === 0, 'bootstrap must exit 0');
  assert(bootstrap.parsed.ok === true, 'bootstrap must report ok=true');
  assert(bootstrap.parsed.evidence.adoptedProfile === 'default', 'bootstrap must report adoptedProfile=default');

  for (const relativePath of [
    'AGENTS.md',
    '.atm/config.json',
    '.atm/runtime/profile/default.md',
    '.atm/runtime/current-task.json',
    '.atm/runtime/project-probe.json',
    '.atm/runtime/default-guards.json',
    '.atm/runtime/budget/default-policy.json',
    '.atm/history/handoff/INITIAL_SUMMARY.md',
    '.atm/history/handoff/BOOTSTRAP-0001.json',
    '.atm/history/handoff/BOOTSTRAP-0001.md',
    '.atm/history/tasks/BOOTSTRAP-0001.json',
    '.atm/runtime/locks/BOOTSTRAP-0001.lock.json',
    '.atm/history/evidence/BOOTSTRAP-0001.json',
    '.atm/history/reports/context-budget/bootstrap-bootstrap-BOOTSTRAP-0001.json',
    '.atm/history/reports/continuation/BOOTSTRAP-0001.json',
    '.atm/history/artifacts',
    '.atm/history/logs',
    '.atm/history/reports'
  ]) {
    assert(existsSync(path.join(hostRepo, relativePath)), `bootstrap must create ${relativePath}`);
  }

  assert(bootstrap.parsed.evidence.contextBudgetReportPath === '.atm/history/reports/context-budget/bootstrap-bootstrap-BOOTSTRAP-0001.json', 'bootstrap must surface context budget report path');
  assert(bootstrap.parsed.evidence.contextSummaryPath === '.atm/history/handoff/BOOTSTRAP-0001.json', 'bootstrap must surface context summary json path');
  assert(bootstrap.parsed.evidence.contextSummaryMarkdownPath === '.atm/history/handoff/BOOTSTRAP-0001.md', 'bootstrap must surface context summary markdown path');
  assert(bootstrap.parsed.evidence.continuationReportPath === '.atm/history/reports/continuation/BOOTSTRAP-0001.json', 'bootstrap must surface continuation report path');

  const probe = readJson(path.join(hostRepo, '.atm', 'runtime', 'project-probe.json'));
  assert(probe.repositoryKind === 'static-site', 'project probe must detect static-site repository kind');
  assert(probe.packageManager === 'none', 'project probe must keep packageManager=none for static site');
  assert(probe.hostWorkflow === 'file-publish', 'project probe must report file-publish host workflow');

  const guards = readJson(path.join(hostRepo, '.atm', 'runtime', 'default-guards.json'));
  assert(Array.isArray(guards.guards) && guards.guards.length === 4, 'default guards must contain 4 starter guards');
  assert(guards.guards.some((guard) => guard.id === 'protect-context-budget'), 'default guards must include protect-context-budget');

  const agents = readFileSync(path.join(hostRepo, 'AGENTS.md'), 'utf8');
  assert(agents.includes('.atm/history/tasks/BOOTSTRAP-0001.json'), 'AGENTS.md must point to bootstrap task');
  assert(agents.includes('Read README.md if present'), 'AGENTS.md must contain the one-line kickoff prompt');

  const status = runAtm(['status', '--cwd', hostRepo], hostRepo);
  assert(status.exitCode === 0, 'status after adopt must exit 0');
  assert(status.parsed.ok === true, 'status after adopt must report ok=true');
  assert(status.parsed.evidence.adoptedProfile === 'default', 'status must report adoptedProfile=default');
  assert(status.parsed.evidence.repositoryKind === 'static-site', 'status must surface repositoryKind from project probe');

  const validate = runAtm(['validate', '--cwd', hostRepo], hostRepo);
  assert(validate.exitCode === 0, 'validate after adopt must exit 0');
  assert(validate.parsed.ok === true, 'validate after adopt must report ok=true');

  const secondBootstrap = runAtm(['bootstrap', '--cwd', hostRepo], hostRepo);
  assert(secondBootstrap.exitCode === 0, 'second bootstrap must still exit 0');
  assert(secondBootstrap.parsed.ok === true, 'second bootstrap must report ok=true');
  assert(Array.isArray(secondBootstrap.parsed.evidence.unchanged), 'second bootstrap must report unchanged files');
  assert(secondBootstrap.parsed.evidence.unchanged.includes('AGENTS.md'), 'second bootstrap must leave AGENTS.md unchanged without --force');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[bootstrap:' + mode + '] ok (bootstrap command, static-site probe, and one-line kickoff verified)');
}
