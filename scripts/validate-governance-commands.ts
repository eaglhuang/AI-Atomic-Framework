import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from './temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: any) {
  console.error(`[governance-commands:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function runAtm(args: any) {
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

function runGit(cwd: string, args: string[]) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8'
  });
  return {
    exitCode: result.status ?? 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim()
  };
}

const tempRoot = createTempWorkspace('atm-governance-commands-');
try {
  const repo = path.join(tempRoot, 'repo');
  mkdirSync(repo, { recursive: true });
  const gitInit = runGit(repo, ['init']);
  assert(gitInit.exitCode === 0, 'git init must succeed for governance command validation');
  assert(runGit(repo, ['config', 'user.name', 'bootstrap']).exitCode === 0, 'fixture git user.name must be configured');
  assert(runGit(repo, ['config', 'user.email', 'bootstrap@example.com']).exitCode === 0, 'fixture git user.email must be configured');

  const bootstrap = runAtm(['bootstrap', '--cwd', repo, '--task', 'Bootstrap ATM in this repository', '--json']);
  assert(bootstrap.exitCode === 0, 'bootstrap must exit 0 for governance command validation');
  assert(bootstrap.parsed.ok === true, 'bootstrap must report ok=true for governance command validation');
  assert(runGit(repo, ['add', '.']).exitCode === 0, 'fixture bootstrap files must be stageable');
  assert(runGit(repo, ['commit', '-m', 'chore: bootstrap fixture']).exitCode === 0, 'fixture bootstrap commit must succeed');

  const missingLock = runAtm(['lock', 'check', '--cwd', repo, '--task', 'ATM-FIXTURE-0099', '--json']);
  assert(missingLock.exitCode === 1, 'lock check on missing task must exit 1');
  assert(missingLock.parsed.ok === false, 'lock check on missing task must report ok=false');

  const lockTaskId = 'ATM-FIXTURE-LOCK';

  const acquiredLock = runAtm(['lock', 'acquire', '--cwd', repo, '--task', lockTaskId, '--owner', 'fixture-agent', '--files', 'src/example.ts', '--json']);
  assert(acquiredLock.exitCode === 0, 'lock acquire must exit 0');
  assert(acquiredLock.parsed.ok === true, 'lock acquire must report ok=true');

  const checkedLock = runAtm(['lock', 'check', '--cwd', repo, '--task', lockTaskId, '--json']);
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

  const reserveTask = runAtm(['tasks', 'reserve', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--title', 'Reservation test', '--json']);
  assert(reserveTask.exitCode === 0, 'tasks reserve must exit 0');
  assert(reserveTask.parsed.ok === true, 'tasks reserve must report ok=true');
  assert(reserveTask.parsed.evidence.status === 'reserved', 'tasks reserve must set reserved status');

  const promoteTask = runAtm(['tasks', 'promote', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--json']);
  assert(promoteTask.exitCode === 0, 'tasks promote must exit 0');
  assert(promoteTask.parsed.ok === true, 'tasks promote must report ok=true');
  assert(promoteTask.parsed.evidence.status === 'ready', 'tasks promote must set ready status');

  const nextClaim = runAtm(['next', '--cwd', repo, '--claim', '--actor', 'fixture-agent', '--json']);
  assert(nextClaim.exitCode === 0, 'next --claim must exit 0');
  assert(nextClaim.parsed.ok === true, 'next --claim must report ok=true');
  assert(nextClaim.parsed.evidence.claimResult?.action === 'claim', 'next --claim must include claim evidence');
  assert(nextClaim.parsed.evidence.claimResult?.taskId === 'ATM-GOV-0103', 'next --claim must claim selected task');

  const taskPath = path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0103.json');
  const taskAfterClaim = JSON.parse(readFileSync(taskPath, 'utf8'));
  assert(taskAfterClaim.status === 'running', 'tasks claim must update task status to running');
  const claimLeaseId = String(nextClaim.parsed.evidence.claimResult?.claim?.leaseId ?? '');
  assert(claimLeaseId.length > 0, 'next --claim must produce a lease id');

  const registerActor = runAtm([
    'actor',
    'register',
    '--cwd',
    repo,
    '--id',
    'fixture-agent',
    '--kind',
    'ai-agent',
    '--name',
    'Fixture Agent',
    '--git-name',
    'fixture-agent',
    '--git-email',
    'fixture-agent@example.com',
    '--json'
  ]);
  assert(registerActor.exitCode === 0, 'actor register must exit 0');
  assert(registerActor.parsed.ok === true, 'actor register must report ok=true');

  const mutationGuard = runAtm(['guard', 'mutation', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--files', '.atm/history/tasks/ATM-GOV-0103.json', '--json']);
  assert(mutationGuard.exitCode === 0, 'guard mutation must pass for in-scope claimed file');
  assert(mutationGuard.parsed.ok === true, 'guard mutation must report ok=true for in-scope claimed file');

  const conflictClaim = runAtm(['tasks', 'claim', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'other-agent', '--files', '.atm/history/tasks/ATM-GOV-0103.json', '--json']);
  assert(conflictClaim.exitCode === 1, 'tasks claim conflict must exit 1');
  assert(conflictClaim.parsed.ok === false, 'tasks claim conflict must report ok=false');
  assert(conflictClaim.parsed.messages?.[0]?.code === 'ATM_LOCK_CONFLICT', 'tasks claim conflict must return ATM_LOCK_CONFLICT');

  const gitPrepare = runAtm(['git', 'prepare', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--json']);
  assert(gitPrepare.exitCode === 0, 'git prepare must exit 0');
  assert(gitPrepare.parsed.ok === true, 'git prepare must report ok=true');

  const governedFile = path.join(repo, 'notes', 'governance.txt');
  mkdirSync(path.dirname(governedFile), { recursive: true });
  writeFileSync(governedFile, 'governance fixture\n', 'utf8');
  assert(runGit(repo, ['add', '.']).exitCode === 0, 'governance fixture commit staging must succeed');
  const commitMessage = [
    'feat: governed fixture commit',
    '',
    'ATM-Actor: fixture-agent',
    'ATM-Task: ATM-GOV-0103',
    `ATM-Claim: ${claimLeaseId}`,
    'ATM-Evidence: .atm/history/evidence/ATM-GOV-0103.json'
  ].join('\n');
  assert(runGit(repo, ['commit', '-m', commitMessage]).exitCode === 0, 'governance fixture commit must succeed');

  const gitCheck = runAtm(['git', 'check', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--json']);
  assert(gitCheck.exitCode === 0, 'git check must exit 0 for matching trailers and identity');
  assert(gitCheck.parsed.ok === true, 'git check must report ok=true for matching trailers and identity');

  const gitGuard = runAtm(['guard', 'git', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--json']);
  assert(gitGuard.exitCode === 0, 'guard git must exit 0 for matching trailers and identity');
  assert(gitGuard.parsed.ok === true, 'guard git must report ok=true for matching trailers and identity');

  const addEvidence = runAtm(['evidence', 'add', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--kind', 'test', '--summary', 'fixture governance command validation passed', '--artifacts', 'notes/governance.txt', '--json']);
  assert(addEvidence.exitCode === 0, 'evidence add must exit 0');
  assert(addEvidence.parsed.ok === true, 'evidence add must report ok=true');

  const verifyEvidence = runAtm(['evidence', 'verify', '--cwd', repo, '--task', 'ATM-GOV-0103', '--gate', 'close', '--json']);
  assert(verifyEvidence.exitCode === 0, 'evidence verify close gate must exit 0');
  assert(verifyEvidence.parsed.ok === true, 'evidence verify close gate must report ok=true');

  const closeTask = runAtm(['tasks', 'close', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--status', 'done', '--json']);
  assert(closeTask.exitCode === 0, 'tasks close done must exit 0 with evidence');
  assert(closeTask.parsed.ok === true, 'tasks close done must report ok=true with evidence');

  const handoff = runAtm(['handoff', 'summarize', '--cwd', repo, '--task', 'BOOTSTRAP-0001', '--json']);
  assert(handoff.exitCode === 0, 'handoff summarize must exit 0');
  assert(handoff.parsed.ok === true, 'handoff summarize must report ok=true');
  assert(existsSyncPortable(repo, handoff.parsed.evidence.summaryPath), 'handoff summary json must be written');
  assert(existsSyncPortable(repo, handoff.parsed.evidence.summaryMarkdownPath), 'handoff summary markdown must be written');

  const releasedLock = runAtm(['lock', 'release', '--cwd', repo, '--task', lockTaskId, '--owner', 'fixture-agent', '--json']);
  assert(releasedLock.exitCode === 0, 'lock release must exit 0');
  assert(releasedLock.parsed.ok === true, 'lock release must report ok=true');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[governance-commands:' + mode + '] ok (lock, budget, guard, evidence, git governance, tasks lifecycle, and handoff commands verified)');
}

function existsSyncPortable(repositoryRoot: any, relativePath: any) {
  return path.isAbsolute(relativePath)
    ? existsSync(path.resolve(relativePath))
    : existsSync(path.join(repositoryRoot, relativePath));
}
