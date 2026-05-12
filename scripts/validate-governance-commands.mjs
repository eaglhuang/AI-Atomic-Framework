import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from './temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message) {
  console.error(`[governance-commands:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runAtm(args) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: payload ? JSON.parse(payload) : {}
  };
}

const tempRoot = createTempWorkspace('atm-governance-commands-');
try {
  const repo = path.join(tempRoot, 'repo');
  mkdirSync(repo, { recursive: true });

  const bootstrap = runAtm(['bootstrap', '--cwd', repo, '--task', 'Bootstrap ATM in this repository', '--json']);
  assert(bootstrap.exitCode === 0, 'bootstrap must exit 0 for governance command validation');
  assert(bootstrap.parsed.ok === true, 'bootstrap must report ok=true for governance command validation');

  const missingLock = runAtm(['lock', 'check', '--cwd', repo, '--task', 'ATM-FIXTURE-0099', '--json']);
  assert(missingLock.exitCode === 1, 'lock check on missing task must exit 1');
  assert(missingLock.parsed.ok === false, 'lock check on missing task must report ok=false');

  const acquiredLock = runAtm(['lock', 'acquire', '--cwd', repo, '--task', 'BOOTSTRAP-0001', '--owner', 'fixture-agent', '--files', 'src/example.ts', '--json']);
  assert(acquiredLock.exitCode === 0, 'lock acquire must exit 0');
  assert(acquiredLock.parsed.ok === true, 'lock acquire must report ok=true');

  const checkedLock = runAtm(['lock', 'check', '--cwd', repo, '--task', 'BOOTSTRAP-0001', '--json']);
  assert(checkedLock.exitCode === 0, 'lock check must exit 0');
  assert(checkedLock.parsed.ok === true, 'lock check must report ok=true after acquire');
  assert((checkedLock.parsed.evidence?.lock?.lockedBy ?? checkedLock.parsed.evidence?.lock?.owner) === 'fixture-agent', 'lock check must preserve owner');

  const budgetPass = runAtm(['budget', 'check', '--cwd', repo, '--task', 'BOOTSTRAP-0001', '--estimated-tokens', '64', '--inline-artifacts', '1', '--json']);
  assert(budgetPass.exitCode === 0, 'budget pass check must exit 0');
  assert(budgetPass.parsed.ok === true, 'budget pass check must report ok=true');
  assert(budgetPass.parsed.evidence.decision === 'pass', 'budget pass check must return pass');
  assert(readFileSync(path.join(repo, budgetPass.parsed.evidence.reportPath), 'utf8').includes('"decision": "pass"'), 'budget pass report must be written');

  mkdirSync(path.join(repo, '.atm', 'runtime', 'budget'), { recursive: true });
  writeFileSync(path.join(repo, '.atm', 'runtime', 'budget', 'default-policy.json'), `${JSON.stringify({
    policyId: 'default-policy',
    generatedAt: '2026-01-01T00:00:00.000Z',
    unit: 'tokens',
    warningTokens: 64,
    summarizeTokens: 96,
    hardStopTokens: 128,
    maxInlineArtifacts: 1,
    defaultSummary: 'Summarize before continuing.'
  }, null, 2)}\n`, 'utf8');

  const budgetStop = runAtm(['budget', 'check', '--cwd', repo, '--task', 'BOOTSTRAP-0001', '--estimated-tokens', '512', '--inline-artifacts', '3', '--requested-summary', 'Summarize before continuing.', '--json']);
  assert(budgetStop.exitCode === 1, 'budget hard-stop check must exit 1');
  assert(budgetStop.parsed.ok === false, 'budget hard-stop check must report ok=false');
  assert(budgetStop.parsed.evidence.decision === 'hard-stop', 'budget hard-stop check must return hard-stop');
  assert(Boolean(budgetStop.parsed.evidence.summaryPath), 'budget hard-stop check must create a summary path');

  const goodFile = path.join(repo, 'docs', 'encoding-good.md');
  const badFile = path.join(repo, 'docs', 'encoding-bad.md');
  mkdirSync(path.dirname(goodFile), { recursive: true });
  writeFileSync(goodFile, 'Encoding guard clean fixture.\n', 'utf8');
  writeFileSync(badFile, '\uFEFFbroken \uFFFD content\n', 'utf8');

  const guardPass = runAtm(['guard', 'encoding', '--cwd', repo, '--files', 'docs/encoding-good.md', '--json']);
  assert(guardPass.exitCode === 0, 'guard encoding pass must exit 0');
  assert(guardPass.parsed.ok === true, 'guard encoding pass must report ok=true');

  const guardFail = runAtm(['guard', 'encoding', '--cwd', repo, '--files', 'docs/encoding-bad.md', '--json']);
  assert(guardFail.exitCode === 1, 'guard encoding fail must exit 1');
  assert(guardFail.parsed.ok === false, 'guard encoding fail must report ok=false');
  assert(guardFail.parsed.evidence.findings.length >= 2, 'guard encoding fail must emit findings');

  const handoff = runAtm(['handoff', 'summarize', '--cwd', repo, '--task', 'BOOTSTRAP-0001', '--json']);
  assert(handoff.exitCode === 0, 'handoff summarize must exit 0');
  assert(handoff.parsed.ok === true, 'handoff summarize must report ok=true');
  assert(existsSyncPortable(repo, handoff.parsed.evidence.summaryPath), 'handoff summary json must be written');
  assert(existsSyncPortable(repo, handoff.parsed.evidence.summaryMarkdownPath), 'handoff summary markdown must be written');

  const releasedLock = runAtm(['lock', 'release', '--cwd', repo, '--task', 'BOOTSTRAP-0001', '--owner', 'fixture-agent', '--json']);
  assert(releasedLock.exitCode === 0, 'lock release must exit 0');
  assert(releasedLock.parsed.ok === true, 'lock release must report ok=true');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[governance-commands:' + mode + '] ok (lock, budget, guard, and handoff commands verified)');
}

function existsSyncPortable(repositoryRoot, relativePath) {
  return path.isAbsolute(relativePath)
    ? existsSync(path.resolve(relativePath))
    : existsSync(path.join(repositoryRoot, relativePath));
}
