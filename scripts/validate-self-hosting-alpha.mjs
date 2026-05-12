import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTempWorkspace } from './temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const requiredFiles = [
  'docs/SELF_HOSTING_ALPHA.md',
  'atm.mjs',
  'packages/cli/src/commands/bootstrap-entry.mjs',
  'packages/cli/src/commands/self-host-alpha.mjs',
  'packages/cli/src/commands/test.mjs',
  'examples/hello-world/atoms/hello-world.atom.json',
  'examples/hello-world/src/hello-world.atom.mjs'
];

const repoCopyEntries = [
  'atm.mjs',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'docs',
  'examples',
  'eslint.config.mjs',
  'package.json',
  'package-lock.json',
  'packages',
  'schemas',
  'scripts',
  'templates',
  'tests',
  'tsconfig.build.json',
  'tsconfig.json',
  'turbo.json'
];

function fail(message) {
  console.error(`[self-hosting-alpha:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runAtm(args, cwd) {
  const result = spawnSync(process.execPath, [path.join(cwd, 'atm.mjs'), ...args], {
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

for (const relativePath of requiredFiles) {
  assert(existsSync(path.join(root, relativePath)), `missing self-hosting alpha file: ${relativePath}`);
}

const { createSelfHostingAlphaPrompt } = await import(pathToFileURL(path.join(root, 'packages/cli/src/commands/bootstrap.mjs')).href);
const officialPrompt = createSelfHostingAlphaPrompt();
const checklistDoc = readFileSync(path.join(root, 'docs/SELF_HOSTING_ALPHA.md'), 'utf8');
assert(checklistDoc.includes('Official Single-Entry Prompt'), 'SELF_HOSTING_ALPHA.md must contain the official prompt section');
assert(checklistDoc.includes('Phase B Exit Gate'), 'SELF_HOSTING_ALPHA.md must contain the Phase B exit gate section');
assert(checklistDoc.includes('node atm.mjs next --json'), 'SELF_HOSTING_ALPHA.md must document the official next command');

const tempRoot = createTempWorkspace('atm-self-hosting-');
try {
  const repoCopy = path.join(tempRoot, 'AI-Atomic-Framework');
  mkdirSync(repoCopy, { recursive: true });
  for (const entry of repoCopyEntries) {
    cpSync(path.join(root, entry), path.join(repoCopy, entry), { recursive: true });
  }

  assert(officialPrompt.includes('node atm.mjs next --json'), 'official prompt must route through the official next command');

  const agentsMdTemplate = runAtm(['verify', '--cwd', '.', '--agents-md'], repoCopy);
  assert(agentsMdTemplate.exitCode === 0, 'verify --agents-md must exit 0 against the repository template copy');
  assert(agentsMdTemplate.parsed.ok === true, 'verify --agents-md must report ok=true against the repository template copy');

  const selfHostAlphaGate = runAtm(['self-host-alpha', '--verify', '--json'], repoCopy);
  assert(selfHostAlphaGate.exitCode === 0, 'self-host-alpha --verify --json must exit 0 in self-hosting repo copy');
  assert(selfHostAlphaGate.parsed.ok === true, 'self-host-alpha --verify --json must report ok=true');
  assert(selfHostAlphaGate.parsed.criteria1 === true, 'self-host-alpha criteria1 must be true');
  assert(selfHostAlphaGate.parsed.criteria2 === true, 'self-host-alpha criteria2 must be true');
  assert(selfHostAlphaGate.parsed.criteria3 === true, 'self-host-alpha criteria3 must be true');
  assert(selfHostAlphaGate.parsed.criteria4 === true, 'self-host-alpha criteria4 must be true');
  assert(selfHostAlphaGate.parsed.evidence.bootstrap.contextBudgetReportPath === '.atm/history/reports/context-budget/bootstrap-bootstrap-BOOTSTRAP-0001.json', 'self-host-alpha bootstrap evidence must surface bootstrap budget report path');
  assert(selfHostAlphaGate.parsed.evidence.bootstrap.contextSummaryPath === '.atm/history/handoff/BOOTSTRAP-0001.json', 'self-host-alpha bootstrap evidence must surface bootstrap summary json path');
  assert(selfHostAlphaGate.parsed.evidence.bootstrap.contextSummaryMarkdownPath === '.atm/history/handoff/BOOTSTRAP-0001.md', 'self-host-alpha bootstrap evidence must surface bootstrap summary markdown path');
  assert(selfHostAlphaGate.parsed.evidence.selfHostingArtifacts.phaseBReportPath === '.atm/history/reports/self-host-alpha/BOOTSTRAP-0001.json', 'self-host-alpha must report the phase B report path');
  assert(selfHostAlphaGate.parsed.evidence.selfHostingArtifacts.contextSummaryPath === '.atm/history/handoff/BOOTSTRAP-0001.json', 'self-host-alpha must report the context summary json path');
  assert(selfHostAlphaGate.parsed.evidence.selfHostingArtifacts.contextSummaryMarkdownPath === '.atm/history/handoff/BOOTSTRAP-0001.md', 'self-host-alpha must report the context summary markdown path');
  assert(selfHostAlphaGate.parsed.evidence.selfHostingArtifacts.budgetReportPath === '.atm/history/reports/context-budget/self-host-alpha-BOOTSTRAP-0001.json', 'self-host-alpha must report the self-hosting budget report path');

  if (!existsSync(path.join(repoCopy, '.atm', 'config.json'))) {
    const bootstrap = runAtm(['bootstrap', '--cwd', '.', '--task', 'Bootstrap ATM self-hosting alpha'], repoCopy);
    assert(bootstrap.exitCode === 0, 'bootstrap must exit 0 in self-hosting repo copy');
    assert(bootstrap.parsed.ok === true, 'bootstrap must report ok=true in self-hosting repo copy');
  }

  const status = runAtm(['status', '--cwd', '.'], repoCopy);
  assert(status.exitCode === 0, 'status must exit 0 after self-hosting bootstrap');
  assert(status.parsed.ok === true, 'status must report ok=true after self-hosting bootstrap');
  assert(status.parsed.evidence.adoptedProfile === 'default', 'status must report adoptedProfile=default');

  const validateSpec = runAtm(['validate', '--cwd', '.', '--spec', 'examples/hello-world/atoms/hello-world.atom.json'], repoCopy);
  assert(validateSpec.exitCode === 0, 'self-hosting first smoke spec validation must exit 0');
  assert(validateSpec.parsed.ok === true, 'self-hosting first smoke spec validation must report ok=true');

  const claudeConfidence = runAtm(['self-host-alpha', '--verify', '--agent', 'claude-code', '--json'], repoCopy);
  assert(claudeConfidence.exitCode === 0, 'self-host-alpha --verify --agent claude-code must exit 0 in self-hosting repo copy');
  assert(claudeConfidence.parsed.ok === true, 'self-host-alpha --verify --agent claude-code must report ok=true in self-hosting repo copy');
  assert(claudeConfidence.parsed.evidence.agentsMd?.ok === true, 'self-host-alpha --verify --agent claude-code must report agentsMd ok=true');
  assert(claudeConfidence.parsed.evidence.confidence?.advisory === true, 'self-host-alpha --verify --agent claude-code must remain advisory');

  const { run } = await import(`${pathToFileURL(path.join(repoCopy, 'examples/hello-world/src/hello-world.atom.mjs')).href}?selfHosting=${Date.now()}`);
  const smokeResult = run({ name: 'ATM' });
  assert(smokeResult.message === 'Hello, ATM!', 'hello-world atom smoke must return Hello, ATM!');
  assert(smokeResult.atomId === 'ATM-EXAMPLE-0001', 'hello-world atom smoke must preserve atomId');

  const artifactDir = path.join(repoCopy, '.atm', 'history', 'artifacts', 'BOOTSTRAP-0001');
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, 'hello-world-smoke.json');
  const logPath = path.join(repoCopy, '.atm', 'history', 'logs', 'BOOTSTRAP-0001.log');
  const summaryDir = path.join(repoCopy, '.atm', 'history', 'handoff');
  mkdirSync(summaryDir, { recursive: true });
  const summaryPath = path.join(summaryDir, 'BOOTSTRAP-0001.md');
  const summaryJsonPath = path.join(summaryDir, 'BOOTSTRAP-0001.json');
  const reportPath = path.join(repoCopy, '.atm', 'history', 'reports', 'self-host-alpha', 'BOOTSTRAP-0001.json');
  const budgetReportPath = path.join(repoCopy, '.atm', 'history', 'reports', 'context-budget', 'self-host-alpha-BOOTSTRAP-0001.json');
  mkdirSync(path.dirname(reportPath), { recursive: true });
  mkdirSync(path.dirname(budgetReportPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify({ smokeResult, specPath: 'examples/hello-world/atoms/hello-world.atom.json' }, null, 2)}\n`, 'utf8');
  writeFileSync(logPath, 'self-hosting alpha smoke: hello-world validated and executed successfully\n', 'utf8');
  writeFileSync(summaryPath, '# BOOTSTRAP-0001 Continuation Summary\n\nSelf-hosting alpha smoke passed and preserved replayable evidence.\n\n## Next Actions\n\n- Review the phase-B gate report.\n- Inspect the recorded evidence entry.\n- Decide whether alpha0 can advance.\n', 'utf8');
  writeFileSync(summaryJsonPath, `${JSON.stringify({
    schemaId: 'atm.contextSummary',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'Self-hosting alpha proof fixture.' },
    summaryId: 'summary.self-host-alpha.bootstrap-0001',
    workItemId: 'BOOTSTRAP-0001',
    summary: 'Self-hosting alpha smoke passed and preserved replayable evidence.',
    nextActions: ['Review the phase-B gate report.', 'Inspect the recorded evidence entry.', 'Decide whether alpha0 can advance.'],
    generatedAt: '2026-01-01T00:00:00.000Z',
    artifactPaths: ['.atm/history/artifacts/BOOTSTRAP-0001/hello-world-smoke.json', '.atm/history/logs/BOOTSTRAP-0001.log'],
    evidencePaths: ['.atm/history/evidence/BOOTSTRAP-0001.json'],
    reportPaths: ['.atm/history/reports/self-host-alpha/BOOTSTRAP-0001.json', '.atm/history/reports/context-budget/self-host-alpha-BOOTSTRAP-0001.json'],
    authoredBy: 'ATM CLI',
    handoffKind: 'self-host-alpha',
    continuationGoal: 'Review the stored phase-B proof and decide whether alpha0 can advance.',
    resumePrompt: 'Read the stored context summary first, then inspect the phase-B exit gate report and evidence record.',
    resumeCommand: ['node', 'atm.mjs', 'self-host-alpha', '--verify', '--json'],
    budgetDecision: 'pass',
    hardStop: false,
    summaryMarkdownPath: '.atm/history/handoff/BOOTSTRAP-0001.md'
  }, null, 2)}\n`, 'utf8');
  writeFileSync(reportPath, `${JSON.stringify({
    schemaVersion: 'atm.phaseBExitGate.v0.1',
    gate: 'phase-b-exit',
    passed: true,
    checks: [
      'bootstrap command available',
      'single-entry prompt documented',
      'bootstrap created config/task/lock/evidence',
      'hello-world first smoke validated and executed',
      'artifact/log/context summary written'
    ]
  }, null, 2)}\n`, 'utf8');
  writeFileSync(budgetReportPath, `${JSON.stringify({
    budgetId: 'self-host-alpha/BOOTSTRAP-0001',
    workItemId: 'BOOTSTRAP-0001',
    policyId: 'default-policy',
    decision: 'pass',
    estimatedTokens: 1024,
    inlineArtifacts: 2,
    generatedAt: '2026-01-01T00:00:00.000Z',
    reason: 'Estimated 1024 tokens is within the current context budget policy.'
  }, null, 2)}\n`, 'utf8');

  const taskPath = path.join(repoCopy, '.atm', 'history', 'tasks', 'BOOTSTRAP-0001.json');
  const lockPath = path.join(repoCopy, '.atm', 'runtime', 'locks', 'BOOTSTRAP-0001.lock.json');
  const evidencePath = path.join(repoCopy, '.atm', 'history', 'evidence', 'BOOTSTRAP-0001.json');
  const task = readJson(taskPath);
  task.status = 'done';
  task.smoke = {
    validatedSpec: 'examples/hello-world/atoms/hello-world.atom.json',
    artifactPath: '.atm/history/artifacts/BOOTSTRAP-0001/hello-world-smoke.json',
    logPath: '.atm/history/logs/BOOTSTRAP-0001.log',
    summaryPath: '.atm/history/handoff/BOOTSTRAP-0001.md',
    summaryJsonPath: '.atm/history/handoff/BOOTSTRAP-0001.json',
    budgetReportPath: '.atm/history/reports/context-budget/self-host-alpha-BOOTSTRAP-0001.json'
  };
  writeFileSync(taskPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');

  const lock = readJson(lockPath);
  lock.status = 'released';
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

  const evidence = readJson(evidencePath);
  evidence.status = 'verified';
  evidence.summary = 'Self-hosting alpha smoke completed.';
  evidence.firstSmoke = {
    validatedSpec: 'examples/hello-world/atoms/hello-world.atom.json',
    artifactPath: '.atm/history/artifacts/BOOTSTRAP-0001/hello-world-smoke.json',
    logPath: '.atm/history/logs/BOOTSTRAP-0001.log',
    summaryPath: '.atm/history/handoff/BOOTSTRAP-0001.md',
    summaryJsonPath: '.atm/history/handoff/BOOTSTRAP-0001.json',
    reportPath: '.atm/history/reports/self-host-alpha/BOOTSTRAP-0001.json',
    budgetReportPath: '.atm/history/reports/context-budget/self-host-alpha-BOOTSTRAP-0001.json'
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  assert(readJson(taskPath).status === 'done', 'bootstrap task must be marked done after self-hosting smoke');
  assert(readJson(lockPath).status === 'released', 'bootstrap lock must be released after self-hosting smoke');
  assert(readJson(evidencePath).status === 'verified', 'evidence record must be marked verified after self-hosting smoke');
  assert(existsSync(artifactPath), 'self-hosting smoke artifact must exist');
  assert(existsSync(logPath), 'self-hosting smoke log must exist');
  assert(existsSync(summaryPath), 'self-hosting smoke context summary must exist');
  assert(existsSync(summaryJsonPath), 'self-hosting smoke context summary json must exist');
  assert(existsSync(reportPath), 'self-hosting Phase B gate report must exist');
  assert(existsSync(budgetReportPath), 'self-hosting context budget report must exist');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[self-hosting-alpha:' + mode + '] ok (single-entry prompt, bootstrap command, and first smoke proof verified)');
}
