import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from './temp-root.ts';
import { buildOnefileRelease } from './build-onefile-release.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
let pinnedRunnerSource: string | null = null;

const requiredFiles = [
  'templates/root-drop/AGENTS.md',
  'templates/root-drop/.atm/profile/default.md',
  'templates/root-drop/.atm/context/INITIAL_SUMMARY.md',
  'examples/agent-bootstrap/README.md',
  'examples/agent-bootstrap/static-site-host/README.md',
  'examples/agent-bootstrap/static-site-host/index.html',
  'examples/agent-bootstrap/static-site-host/assets/css/site.css',
  'packages/cli/src/commands/bootstrap.ts',
  'packages/cli/src/commands/bootstrap-entry.ts'
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

function fail(message: any) {
  console.error(`[bootstrap:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function readJson(absolutePath: any) {
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function readText(absolutePath: string) {
  return readFileSync(absolutePath, 'utf8');
}

function runAtm(args: any, cwd: any) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: pinnedRunnerSource
      ? { ...process.env, ATM_PINNED_RUNNER_SOURCE: pinnedRunnerSource }
      : process.env
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error: any) {
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

function assertReadmeEntry(hostRepo: string) {
  const readme = readText(path.join(hostRepo, 'README.md'));
  assert(readme.includes('<!-- ATM README ENTRY:START -->'), 'README.md must include ATM README entry marker');
  assert(readme.includes('node atm.mjs next --prompt "<current user prompt>" --json'), 'README.md must point directly to prompt-scoped ATM next for user work');
  assert(readme.includes('ATM_USER_NOTICE'), 'README.md must tell agents to surface ATM user notices');
  assert(readme.includes('return to the user original request'), 'README.md must tell agents to resume the original request after onboarding');
  assert(!readme.includes('Read AGENTS.md'), 'README.md must not point back to AGENTS.md');
}

function assertPinnedRunner(hostRepo: string) {
  const runnerPath = path.join(hostRepo, 'atm.mjs');
  const metadataPath = path.join(hostRepo, '.atm', 'runtime', 'pinned-runner.json');
  assert(existsSync(runnerPath), 'bootstrap must install root atm.mjs pinned runner');
  assert(existsSync(metadataPath), 'bootstrap must write pinned runner metadata');
  const metadata = readJson(metadataPath);
  assert(metadata.schemaVersion === 'atm.pinnedRunner.v0.1', 'pinned runner metadata schema mismatch');
  assert(metadata.runnerPath === 'atm.mjs', 'pinned runner metadata must point to root atm.mjs');
  assert(metadata.sha256 && metadata.sha256.length === 64, 'pinned runner metadata must include runner sha256');
  assert(metadata.command === 'node atm.mjs next --prompt "<current user prompt>" --json', 'pinned runner metadata must preserve prompt-scoped first command');

  const result = spawnSync(process.execPath, [runnerPath, 'next', '--cwd', hostRepo, '--json'], {
    cwd: hostRepo,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(payload);
  } catch (error: any) {
    fail(`installed pinned runner did not emit JSON: ${payload || error.message}`);
  }
  assert(result.status === 0 || result.status === 1, 'installed pinned runner next must exit with ATM next status after bootstrap');
  assert(parsed.evidence?.nextAction?.command, 'installed pinned runner next must emit a governed next action after bootstrap');
}

function assertFirstUseNotice(nextResult: any) {
  const userNotice = nextResult.parsed.evidence?.userNotice;
  const nextAction = nextResult.parsed.evidence?.nextAction;
  assert(userNotice?.schemaVersion === 'atm.userNotice.v0.1', 'next must emit first-use userNotice schema');
  assert(userNotice.id === 'atm.first-use.governance-available', 'next must emit stable first-use notice id');
  assert(userNotice.displayPolicy === 'show-on-first-contact', 'first-use notice must be marked for first-contact display');
  assert(userNotice.mustShowBeforeAction === true, 'first-use notice must require display before next action');
  assert(userNotice.spokenLine.includes('ATM governance'), 'first-use notice must include a human-readable spoken line');
  assert(userNotice.agentInstruction.includes('MUST briefly tell the user'), 'first-use notice must tell agents to surface it naturally');
  assert(userNotice.afterNextActionInstruction.includes('original request'), 'first-use notice must tell agents to resume the original user request');
  assert(Array.isArray(userNotice.suggestedPrompts) && userNotice.suggestedPrompts.length >= 2, 'first-use notice must include natural-language prompt suggestions');
  assert(userNotice.suggestedPrompts.some((prompt: string) => prompt.includes('ATM features')), 'first-use notice must suggest discovering available ATM features');
  assert(Array.isArray(userNotice.suggestedActions) && userNotice.suggestedActions.length >= 2, 'first-use notice must include suggested actions');
  assert(userNotice.suggestedActions[0].value === nextAction.command, 'first-use primary action must match deterministic next action command');
  assert(nextResult.parsed.messages.some((entry: any) => entry.code === 'ATM_USER_NOTICE'), 'next must emit ATM_USER_NOTICE as a top-level message');
}

function assertAgentsEntry(hostRepo: string, expectedOriginalText?: string) {
  const agents = readText(path.join(hostRepo, 'AGENTS.md'));
  if (expectedOriginalText) {
    assert(agents.includes(expectedOriginalText), 'AGENTS.md must preserve existing host instructions');
    assert(agents.includes('<!-- ATM ROOT ENTRY:START -->'), 'existing AGENTS.md must include managed ATM entry marker');
  }
  assert(agents.includes('node atm.mjs next --prompt "<current user prompt>" --json'), 'AGENTS.md must point to prompt-scoped ATM next for user work');
  assert(agents.includes('ATM_USER_NOTICE'), 'AGENTS.md must tell agents to surface ATM user notices');
  assert(agents.includes('missing local document'), 'AGENTS.md must define missing-document fallback behavior');
  assert(agents.includes('return to the user original request'), 'AGENTS.md must tell agents to resume the original request after onboarding');
  assert(agents.includes('Editor integration self-check'), 'AGENTS.md must define editor integration self-check guidance');
  assert(agents.includes('node atm.mjs integration add codex --json'), 'AGENTS.md must include repo-local Codex integration install guidance');
  assert(agents.includes('.claude/skills/atm-governance-router/SKILL.md'), 'AGENTS.md must include Claude Code entry-file guidance');
  assert(agents.includes('Python-only runtime self-check'), 'AGENTS.md must define Python-only runtime self-check guidance');
  assert(agents.includes('atom birth/apply remains deferred'), 'AGENTS.md must explain that Python atom birth/apply stays deferred without a Python adapter/plugin');
}

function verifyRootEntryScenario(tempRoot: string, scenarioName: string, options: { readonly readme?: boolean; readonly agents?: boolean }) {
  const hostRepo = path.join(tempRoot, scenarioName);
  mkdirSync(hostRepo, { recursive: true });
  const originalAgentsText = 'Original agent instructions stay here.';
  if (options.readme === true) {
    writeFileSync(path.join(hostRepo, 'README.md'), `# ${scenarioName}\n\nExisting repository overview.\n`, 'utf8');
  }
  if (options.agents === true) {
    writeFileSync(path.join(hostRepo, 'AGENTS.md'), `# Agent Instructions\n\n${originalAgentsText}\n`, 'utf8');
  }

  const bootstrap = runAtm(['bootstrap', '--cwd', hostRepo], hostRepo);
  assert(bootstrap.exitCode === 0, `${scenarioName} bootstrap must exit 0`);
  assert(bootstrap.parsed.ok === true, `${scenarioName} bootstrap must report ok=true`);
  assert(existsSync(path.join(hostRepo, 'AGENTS.md')), `${scenarioName} bootstrap must leave AGENTS.md available`);
  assertPinnedRunner(hostRepo);

  if (options.readme === true) {
    assertReadmeEntry(hostRepo);
  } else {
    assert(!existsSync(path.join(hostRepo, 'README.md')), `${scenarioName} must not create README.md when host had none`);
  }

  assertAgentsEntry(hostRepo, options.agents === true ? originalAgentsText : undefined);

  const secondBootstrap = runAtm(['bootstrap', '--cwd', hostRepo], hostRepo);
  assert(secondBootstrap.exitCode === 0, `${scenarioName} second bootstrap must exit 0`);
  assert(secondBootstrap.parsed.ok === true, `${scenarioName} second bootstrap must report ok=true`);
  assert(secondBootstrap.parsed.evidence.unchanged.includes('AGENTS.md'), `${scenarioName} second bootstrap must leave AGENTS.md unchanged`);
  assert(secondBootstrap.parsed.evidence.unchanged.includes('atm.mjs'), `${scenarioName} second bootstrap must leave atm.mjs unchanged`);
  if (options.readme === true) {
    assert(secondBootstrap.parsed.evidence.unchanged.includes('README.md'), `${scenarioName} second bootstrap must leave README.md unchanged`);
  }
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
  pinnedRunnerSource = buildOnefileRelease({
    repositoryRoot: root,
    rootDropRoot: path.join(tempRoot, 'release', 'atm-root-drop'),
    outputRoot: path.join(tempRoot, 'release', 'atm-onefile')
  }).outputFilePath;

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
  assert(bootstrap.parsed.evidence.pinnedRunner?.status === 'installed', 'bootstrap must report pinned runner installed');

  for (const relativePath of [
    'AGENTS.md',
    'atm.mjs',
    '.atm/config.json',
    '.atm/runtime/profile/default.md',
    '.atm/runtime/current-task.json',
    '.atm/runtime/project-probe.json',
    '.atm/runtime/default-guards.json',
    '.atm/runtime/budget/default-policy.json',
    '.atm/runtime/pinned-runner.json',
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
  assert(Array.isArray(guards.guards) && guards.guards.length === 6, 'default guards must contain 6 starter guards');
  assert(guards.guards.some((guard: any) => guard.id === 'protect-context-budget'), 'default guards must include protect-context-budget');
  assert(guards.guards.some((guard: any) => guard.id === 'framework-work-tracking-stays-downstream'), 'default guards must include framework-work-tracking-stays-downstream');
  assert(guards.guards.some((guard: any) => guard.id === 'public-framework-docs-remain-english-only'), 'default guards must include public-framework-docs-remain-english-only');

  const agents = readFileSync(path.join(hostRepo, 'AGENTS.md'), 'utf8');
  assert(agents.includes('.atm/history/tasks/BOOTSTRAP-0001.json'), 'AGENTS.md must point to bootstrap task');
  assert(agents.includes('Read README.md if present'), 'AGENTS.md must contain the one-line kickoff prompt');
  assert(!agents.includes('{{'), 'AGENTS.md must not leak unresolved template placeholders');
  assert(!agents.includes('ATM TEMPLATE'), 'AGENTS.md must not leak template headers');
  assertReadmeEntry(hostRepo);
  assertPinnedRunner(hostRepo);
  const firstNext = runAtm(['next', '--cwd', hostRepo], hostRepo);
  assert(firstNext.exitCode === 1, 'next before ATMChart render must exit with non-ready status');
  assert(firstNext.parsed.evidence.nextAction.status === 'needs-onboarding-refresh', 'next before ATMChart render must request onboarding refresh');
  assert(firstNext.parsed.evidence.nextAction.afterNextAction.includes('original request'), 'onboarding refresh next action must tell agents to resume the original request');
  assertFirstUseNotice(firstNext);

  const profile = readFileSync(path.join(hostRepo, '.atm', 'runtime', 'profile', 'default.md'), 'utf8');
  assert(!profile.includes('{{'), 'default profile must not leak unresolved template placeholders');
  assert(!profile.includes('ATM TEMPLATE'), 'default profile must not leak template headers');

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
  assert(secondBootstrap.parsed.evidence.unchanged.includes('atm.mjs'), 'second bootstrap must leave atm.mjs unchanged without --force');
  assert(secondBootstrap.parsed.evidence.unchanged.includes('README.md'), 'second bootstrap must leave README.md unchanged without --force');

  verifyRootEntryScenario(tempRoot, 'root-entry-readme-only', { readme: true });
  verifyRootEntryScenario(tempRoot, 'root-entry-agents-only', { agents: true });
  verifyRootEntryScenario(tempRoot, 'root-entry-readme-and-agents', { readme: true, agents: true });
  verifyRootEntryScenario(tempRoot, 'root-entry-none', {});
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[bootstrap:' + mode + '] ok (bootstrap command, static-site probe, and one-line kickoff verified)');
}
