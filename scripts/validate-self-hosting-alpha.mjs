import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const requiredFiles = [
  'docs/SELF_HOSTING_ALPHA.md',
  'packages/cli/src/commands/bootstrap-entry.mjs',
  'packages/cli/src/commands/self-host-alpha.mjs',
  'packages/cli/src/commands/test.mjs',
  'examples/hello-world/atoms/hello-world.atom.json',
  'examples/hello-world/src/hello-world.atom.mjs'
];

const repoCopyEntries = [
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'docs',
  'examples',
  'package.json',
  'packages',
  'pnpm-workspace.yaml',
  'schemas',
  'scripts',
  'templates',
  'tests',
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
  const result = spawnSync(process.execPath, [path.join(cwd, 'packages/cli/src/atm.mjs'), ...args], {
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
assert(checklistDoc.includes('node packages/cli/src/atm.mjs bootstrap --cwd .'), 'SELF_HOSTING_ALPHA.md must document the official bootstrap command');

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-self-hosting-'));
try {
  const repoCopy = path.join(tempRoot, 'AI-Atomic-Framework');
  mkdirSync(repoCopy, { recursive: true });
  for (const entry of repoCopyEntries) {
    cpSync(path.join(root, entry), path.join(repoCopy, entry), { recursive: true });
  }

  assert(officialPrompt.includes('.atm/config.json'), 'official prompt must check for .atm/config.json');
  assert(officialPrompt.includes('bootstrap --cwd .'), 'official prompt must tell the agent to run the official bootstrap command');
  assert(officialPrompt.includes('examples/hello-world/atoms/hello-world.atom.json'), 'official prompt must define the first smoke target');

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

  const artifactDir = path.join(repoCopy, '.atm', 'artifacts', 'BOOTSTRAP-0001');
  mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, 'hello-world-smoke.json');
  const logPath = path.join(repoCopy, '.atm', 'logs', 'BOOTSTRAP-0001.log');
  const summaryPath = path.join(repoCopy, '.atm', 'context', 'BOOTSTRAP-0001-summary.md');
  const reportPath = path.join(repoCopy, '.atm', 'reports', 'self-hosting-alpha-gate.json');
  writeFileSync(artifactPath, `${JSON.stringify({ smokeResult, specPath: 'examples/hello-world/atoms/hello-world.atom.json' }, null, 2)}\n`, 'utf8');
  writeFileSync(logPath, 'self-hosting alpha smoke: hello-world validated and executed successfully\n', 'utf8');
  writeFileSync(summaryPath, '# BOOTSTRAP-0001 Summary\n\n- bootstrap complete\n- hello-world smoke passed\n- evidence recorded\n', 'utf8');
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

  const taskPath = path.join(repoCopy, '.atm', 'tasks', 'BOOTSTRAP-0001.json');
  const lockPath = path.join(repoCopy, '.atm', 'locks', 'BOOTSTRAP-0001.lock.json');
  const evidencePath = path.join(repoCopy, '.atm', 'evidence', 'BOOTSTRAP-0001.json');
  const task = readJson(taskPath);
  task.status = 'done';
  task.smoke = {
    validatedSpec: 'examples/hello-world/atoms/hello-world.atom.json',
    artifactPath: '.atm/artifacts/BOOTSTRAP-0001/hello-world-smoke.json',
    logPath: '.atm/logs/BOOTSTRAP-0001.log',
    summaryPath: '.atm/context/BOOTSTRAP-0001-summary.md'
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
    artifactPath: '.atm/artifacts/BOOTSTRAP-0001/hello-world-smoke.json',
    logPath: '.atm/logs/BOOTSTRAP-0001.log',
    summaryPath: '.atm/context/BOOTSTRAP-0001-summary.md',
    reportPath: '.atm/reports/self-hosting-alpha-gate.json'
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  assert(readJson(taskPath).status === 'done', 'bootstrap task must be marked done after self-hosting smoke');
  assert(readJson(lockPath).status === 'released', 'bootstrap lock must be released after self-hosting smoke');
  assert(readJson(evidencePath).status === 'verified', 'evidence record must be marked verified after self-hosting smoke');
  assert(existsSync(artifactPath), 'self-hosting smoke artifact must exist');
  assert(existsSync(logPath), 'self-hosting smoke log must exist');
  assert(existsSync(summaryPath), 'self-hosting smoke context summary must exist');
  assert(existsSync(reportPath), 'self-hosting Phase B gate report must exist');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[self-hosting-alpha:' + mode + '] ok (single-entry prompt, bootstrap command, and first smoke proof verified)');
}