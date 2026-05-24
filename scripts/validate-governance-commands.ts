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
  const reservedTaskDocument = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0103.json'), 'utf8'));
  assert(reservedTaskDocument.status === 'reserved', 'tasks reserve must persist reserved status to the main task document');

  const claimBeforeReady = runAtm(['tasks', 'claim', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--files', '.atm/history/tasks/ATM-GOV-0103.json', '--json']);
  assert(claimBeforeReady.exitCode === 1, 'tasks claim before ready must exit 1');
  assert(claimBeforeReady.parsed.ok === false, 'tasks claim before ready must report ok=false');
  assert(claimBeforeReady.parsed.messages?.[0]?.code === 'ATM_TASK_CLAIM_NOT_READY', 'tasks claim before ready must return ATM_TASK_CLAIM_NOT_READY');

  const promoteTask = runAtm(['tasks', 'promote', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--json']);
  assert(promoteTask.exitCode === 0, 'tasks promote must exit 0');
  assert(promoteTask.parsed.ok === true, 'tasks promote must report ok=true');
  assert(promoteTask.parsed.evidence.status === 'ready', 'tasks promote must set ready status');
  const promotedTaskDocument = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0103.json'), 'utf8'));
  assert(promotedTaskDocument.status === 'ready', 'tasks promote must persist ready status to the main task document');

  const nextClaim = runAtm(['next', '--cwd', repo, '--claim', '--actor', 'fixture-agent', '--prompt', 'ATM-GOV-0103', '--json']);
  assert(nextClaim.exitCode === 0, 'next --claim must exit 0');
  assert(nextClaim.parsed.ok === true, 'next --claim must report ok=true');
  assert(nextClaim.parsed.evidence.claimResult?.action === 'claim', 'next --claim must include claim evidence');
  assert(nextClaim.parsed.evidence.claimResult?.taskId === 'ATM-GOV-0103', 'next --claim must claim selected task');

  const taskPath = path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0103.json');
  const taskAfterClaim = JSON.parse(readFileSync(taskPath, 'utf8'));
  assert(taskAfterClaim.status === 'running', 'tasks claim must update task status to running');
  const claimLeaseId = String(nextClaim.parsed.evidence.claimResult?.claim?.leaseId ?? '');
  assert(claimLeaseId.length > 0, 'next --claim must produce a lease id');

  const renewTask = runAtm(['tasks', 'reserve', '--cwd', repo, '--task', 'ATM-GOV-0102', '--actor', 'fixture-agent', '--title', 'Renew release test', '--json']);
  assert(renewTask.exitCode === 0, 'secondary tasks reserve must exit 0');
  assert(renewTask.parsed.ok === true, 'secondary tasks reserve must report ok=true');
  const renewPromote = runAtm(['tasks', 'promote', '--cwd', repo, '--task', 'ATM-GOV-0102', '--actor', 'fixture-agent', '--json']);
  assert(renewPromote.exitCode === 0, 'secondary tasks promote must exit 0');
  assert(renewPromote.parsed.ok === true, 'secondary tasks promote must report ok=true');
  const renewClaim = runAtm(['tasks', 'claim', '--cwd', repo, '--task', 'ATM-GOV-0102', '--actor', 'fixture-agent', '--files', '.atm/history/tasks/ATM-GOV-0102.json', '--ttl-seconds', '30', '--json']);
  assert(renewClaim.exitCode === 0, 'secondary tasks claim must exit 0');
  assert(renewClaim.parsed.ok === true, 'secondary tasks claim must report ok=true');
  const renewedClaim = runAtm(['tasks', 'renew', '--cwd', repo, '--task', 'ATM-GOV-0102', '--actor', 'fixture-agent', '--ttl-seconds', '60', '--json']);
  assert(renewedClaim.exitCode === 0, 'tasks renew must exit 0');
  assert(renewedClaim.parsed.ok === true, 'tasks renew must report ok=true');
  assert(renewedClaim.parsed.evidence.claim?.ttlSeconds === 60, 'tasks renew must update ttlSeconds when provided');
  const renewTaskPath = path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0102.json');
  const taskAfterRenew = JSON.parse(readFileSync(renewTaskPath, 'utf8'));
  assert(taskAfterRenew.claim?.state === 'active', 'tasks renew must preserve active claim state');
  const releasedClaim = runAtm(['tasks', 'release', '--cwd', repo, '--task', 'ATM-GOV-0102', '--actor', 'fixture-agent', '--reason', 'yield to queue', '--json']);
  assert(releasedClaim.exitCode === 0, 'tasks release must exit 0');
  assert(releasedClaim.parsed.ok === true, 'tasks release must report ok=true');
  const taskAfterRelease = JSON.parse(readFileSync(renewTaskPath, 'utf8'));
  assert(taskAfterRelease.status === 'open', 'tasks release must move running task back to open');
  assert(taskAfterRelease.claim?.state === 'released', 'tasks release must persist released claim state');

  const handoffReserve = runAtm(['tasks', 'reserve', '--cwd', repo, '--task', 'ATM-GOV-0108', '--actor', 'fixture-agent', '--title', 'Handoff test', '--json']);
  assert(handoffReserve.exitCode === 0, 'handoff tasks reserve must exit 0');
  const handoffPromote = runAtm(['tasks', 'promote', '--cwd', repo, '--task', 'ATM-GOV-0108', '--actor', 'fixture-agent', '--json']);
  assert(handoffPromote.exitCode === 0, 'handoff tasks promote must exit 0');
  const handoffClaim = runAtm(['tasks', 'claim', '--cwd', repo, '--task', 'ATM-GOV-0108', '--actor', 'fixture-agent', '--files', '.atm/history/tasks/ATM-GOV-0108.json', '--json']);
  assert(handoffClaim.exitCode === 0, 'handoff tasks claim must exit 0');
  const handoffTask = runAtm(['tasks', 'handoff', '--cwd', repo, '--task', 'ATM-GOV-0108', '--actor', 'fixture-agent', '--to', 'review-agent', '--reason', 'request review', '--json']);
  assert(handoffTask.exitCode === 0, 'tasks handoff must exit 0');
  assert(handoffTask.parsed.ok === true, 'tasks handoff must report ok=true');
  const handoffTaskPath = path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0108.json');
  const taskAfterHandoff = JSON.parse(readFileSync(handoffTaskPath, 'utf8'));
  assert(taskAfterHandoff.owner === 'review-agent', 'tasks handoff must transfer owner');
  assert(taskAfterHandoff.status === 'open', 'tasks handoff must reopen the task for the recipient');
  assert(taskAfterHandoff.claim?.state === 'handoff', 'tasks handoff must persist handoff claim state');
  assert(taskAfterHandoff.claim?.handoffTo === 'review-agent', 'tasks handoff must record handoff target');

  const takeoverReserve = runAtm(['tasks', 'reserve', '--cwd', repo, '--task', 'ATM-GOV-0109', '--actor', 'stale-agent', '--title', 'Takeover test', '--json']);
  assert(takeoverReserve.exitCode === 0, 'takeover tasks reserve must exit 0');
  const takeoverPromote = runAtm(['tasks', 'promote', '--cwd', repo, '--task', 'ATM-GOV-0109', '--actor', 'stale-agent', '--json']);
  assert(takeoverPromote.exitCode === 0, 'takeover tasks promote must exit 0');
  const takeoverClaim = runAtm(['tasks', 'claim', '--cwd', repo, '--task', 'ATM-GOV-0109', '--actor', 'stale-agent', '--files', '.atm/history/tasks/ATM-GOV-0109.json', '--ttl-seconds', '30', '--json']);
  assert(takeoverClaim.exitCode === 0, 'takeover tasks claim must exit 0');
  const missingTakeoverReason = runAtm(['tasks', 'takeover', '--cwd', repo, '--task', 'ATM-GOV-0109', '--actor', 'rescuer-agent', '--json']);
  assert(missingTakeoverReason.exitCode === 2, 'tasks takeover without reason must exit 2');
  assert(missingTakeoverReason.parsed.ok === false, 'tasks takeover without reason must report ok=false');
  const takeoverTaskPath = path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0109.json');
  const expiredTakeoverTask = JSON.parse(readFileSync(takeoverTaskPath, 'utf8'));
  expiredTakeoverTask.claim.heartbeatAt = '2020-01-01T00:00:00.000Z';
  expiredTakeoverTask.claim.ttlSeconds = 30;
  writeFileSync(takeoverTaskPath, `${JSON.stringify(expiredTakeoverTask, null, 2)}\n`, 'utf8');
  const takeoverTask = runAtm(['tasks', 'takeover', '--cwd', repo, '--task', 'ATM-GOV-0109', '--actor', 'rescuer-agent', '--reason', 'ttl expired', '--json']);
  assert(takeoverTask.exitCode === 0, 'tasks takeover must exit 0 for an expired claim');
  assert(takeoverTask.parsed.ok === true, 'tasks takeover must report ok=true for an expired claim');
  const taskAfterTakeover = JSON.parse(readFileSync(takeoverTaskPath, 'utf8'));
  assert(taskAfterTakeover.owner === 'rescuer-agent', 'tasks takeover must transfer ownership');
  assert(taskAfterTakeover.status === 'running', 'tasks takeover must move task back to running');
  assert(taskAfterTakeover.claim?.state === 'taken_over', 'tasks takeover must persist taken_over claim state');
  const takeoverEvidencePath = path.join(repo, '.atm', 'history', 'evidence', 'ATM-GOV-0109.json');
  assert(existsSync(takeoverEvidencePath), 'tasks takeover must write takeover evidence');
  assert(readFileSync(takeoverEvidencePath, 'utf8').includes('ttl expired'), 'tasks takeover evidence must preserve the explicit reason');

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

  const mutationGuardFailOpen = runAtm(['guard', 'mutation', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--files', 'outside/scope.ts', '--fail-open', '--json']);
  assert(mutationGuardFailOpen.exitCode === 0, 'guard mutation --fail-open must exit 0 when violations exist');
  assert(mutationGuardFailOpen.parsed.ok === true, 'guard mutation --fail-open must report ok=true when violations exist');
  assert(mutationGuardFailOpen.parsed.messages?.[0]?.code === 'ATM_GUARD_MUTATION_FAIL_OPEN', 'guard mutation --fail-open must return fail-open warning code');

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

  const gitCheckNoTrailers = runAtm(['git', 'check', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--no-trailers', '--json']);
  assert(gitCheckNoTrailers.exitCode === 0, 'git check --no-trailers must exit 0 when identity and ownership are valid');
  assert(gitCheckNoTrailers.parsed.ok === true, 'git check --no-trailers must report ok=true when identity and ownership are valid');

  const gitGuard = runAtm(['guard', 'git', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--json']);
  assert(gitGuard.exitCode === 0, 'guard git must exit 0 for matching trailers and identity');
  assert(gitGuard.parsed.ok === true, 'guard git must report ok=true for matching trailers and identity');

  const gitGuardFailOpen = runAtm(['guard', 'git', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'other-agent', '--fail-open', '--json']);
  assert(gitGuardFailOpen.exitCode === 0, 'guard git --fail-open must exit 0 when violations exist');
  assert(gitGuardFailOpen.parsed.ok === true, 'guard git --fail-open must report ok=true when violations exist');
  assert(gitGuardFailOpen.parsed.messages?.[0]?.code === 'ATM_GUARD_GIT_FAIL_OPEN', 'guard git --fail-open must return fail-open warning code');

  const addEvidence = runAtm([
    'evidence',
    'add',
    '--cwd',
    repo,
    '--task',
    'ATM-GOV-0103',
    '--actor',
    'fixture-agent',
    '--kind',
    'test',
    '--summary',
    'fixture governance command validation passed',
    '--artifacts',
    'notes/governance.txt',
    '--freshness',
    'fresh',
    '--command',
    'npm run typecheck',
    '--exit-code',
    '0',
    '--stdout-sha256',
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    '--stderr-sha256',
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '--validators',
    'typecheck,validate:cli',
    '--json'
  ]);
  assert(addEvidence.exitCode === 0, 'evidence add must exit 0');
  assert(addEvidence.parsed.ok === true, 'evidence add must report ok=true');
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', 'ATM-GOV-0103.json');
  const evidenceBundle = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert(evidenceBundle.evidence?.[0]?.evidenceFreshness === 'fresh', 'evidence add must persist fresh evidence metadata');
  assert(evidenceBundle.evidence?.[0]?.details?.commandRuns?.[0]?.command === 'npm run typecheck', 'evidence add must persist command-run proof');

  const verifyCommitEvidence = runAtm(['evidence', 'verify', '--cwd', repo, '--task', 'ATM-GOV-0103', '--gate', 'commit', '--json']);
  assert(verifyCommitEvidence.exitCode === 0, 'evidence verify commit gate must exit 0');
  assert(verifyCommitEvidence.parsed.ok === true, 'evidence verify commit gate must report ok=true');

  writeFileSync(path.join(repo, '.atm', 'history', 'tasks', 'SANGUO-RAGOPS-0001.json'), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'SANGUO-RAGOPS-0001',
    title: 'Legacy imported task',
    status: 'closed',
    dependencies: [],
    evidencePath: '.atm/history/evidence/SANGUO-RAGOPS-0001.json',
    source: {
      planPath: 'docs/legacy-plan.md',
      sectionTitle: 'Legacy section'
    }
  }, null, 2)}\n`, 'utf8');
  const legacyVerify = runAtm(['tasks', 'verify', '--cwd', repo, '--json']);
  assert(legacyVerify.exitCode === 0, 'tasks verify must tolerate legacy historical task records');
  assert(legacyVerify.parsed.ok === true, 'tasks verify must keep legacy historical task records as warnings');
  const legacyFindingCodes = (legacyVerify.parsed.evidence?.report?.findings ?? []).map((entry: any) => entry.code);
  assert(legacyFindingCodes.includes('ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS'), 'tasks verify must warn on legacy closed status alias');
  assert(legacyFindingCodes.includes('ATM_TASKS_VERIFY_LEGACY_SOURCE_TRACE'), 'tasks verify must warn on legacy source traces missing hash metadata');

  const verifyPrEvidenceFail = runAtm(['evidence', 'verify', '--cwd', repo, '--task', 'ATM-GOV-0103', '--gate', 'pr', '--json']);
  assert(verifyPrEvidenceFail.exitCode === 1, 'evidence verify pr gate without review must exit 1');
  assert(verifyPrEvidenceFail.parsed.ok === false, 'evidence verify pr gate without review must report ok=false');
  assert(verifyPrEvidenceFail.parsed.evidence.missing.includes('review-evidence'), 'evidence verify pr gate without review must name missing review evidence');

  const addReviewEvidence = runAtm(['evidence', 'add', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--kind', 'review', '--summary', 'peer review acknowledged', '--artifacts', 'notes/governance.txt', '--json']);
  assert(addReviewEvidence.exitCode === 0, 'review evidence add must exit 0');
  assert(addReviewEvidence.parsed.ok === true, 'review evidence add must report ok=true');

  const verifyPrEvidence = runAtm(['evidence', 'verify', '--cwd', repo, '--task', 'ATM-GOV-0103', '--gate', 'pr', '--json']);
  assert(verifyPrEvidence.exitCode === 0, 'evidence verify pr gate must exit 0 after review evidence');
  assert(verifyPrEvidence.parsed.ok === true, 'evidence verify pr gate must report ok=true after review evidence');

  const verifyEvidence = runAtm(['evidence', 'verify', '--cwd', repo, '--task', 'ATM-GOV-0103', '--gate', 'close', '--json']);
  assert(verifyEvidence.exitCode === 0, 'evidence verify close gate must exit 0');
  assert(verifyEvidence.parsed.ok === true, 'evidence verify close gate must report ok=true');

  const artifactOnlyReserve = runAtm(['tasks', 'reserve', '--cwd', repo, '--task', 'ATM-GOV-0110', '--actor', 'fixture-agent', '--title', 'Artifact-only closure guard', '--json']);
  assert(artifactOnlyReserve.exitCode === 0, 'artifact-only tasks reserve must exit 0');
  const artifactOnlyPromote = runAtm(['tasks', 'promote', '--cwd', repo, '--task', 'ATM-GOV-0110', '--actor', 'fixture-agent', '--json']);
  assert(artifactOnlyPromote.exitCode === 0, 'artifact-only tasks promote must exit 0');
  const artifactOnlyTaskPath = path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0110.json');
  const artifactOnlyTask = JSON.parse(readFileSync(artifactOnlyTaskPath, 'utf8'));
  artifactOnlyTask.targetRepo = 'AI-Atomic-Framework';
  artifactOnlyTask.closureAuthority = 'target_repo';
  artifactOnlyTask.notes = 'redteam reopened_for_clean_redo';
  writeFileSync(artifactOnlyTaskPath, `${JSON.stringify(artifactOnlyTask, null, 2)}\n`, 'utf8');
  const artifactOnlyEvidence = runAtm([
    'evidence',
    'add',
    '--cwd',
    repo,
    '--task',
    'ATM-GOV-0110',
    '--actor',
    'fixture-agent',
    '--kind',
    'artifact',
    '--summary',
    'static report only',
    '--freshness',
    'historical-reference',
    '--artifacts',
    'notes/governance.txt',
    '--json'
  ]);
  assert(artifactOnlyEvidence.exitCode === 0, 'artifact-only evidence add must exit 0');
  const artifactOnlyVerify = runAtm(['evidence', 'verify', '--cwd', repo, '--task', 'ATM-GOV-0110', '--gate', 'close', '--json']);
  assert(artifactOnlyVerify.exitCode === 1, 'artifact-only close evidence must exit 1 for reopened framework-like tasks');
  assert(artifactOnlyVerify.parsed.ok === false, 'artifact-only close evidence must report ok=false');
  assert(artifactOnlyVerify.parsed.evidence.missing.includes('fresh-evidence-required'), 'artifact-only close evidence must require fresh evidence');
  assert(artifactOnlyVerify.parsed.evidence.missing.includes('artifact-only-evidence-not-allowed'), 'artifact-only close evidence must reject artifact-only closure');

  const staticEvidenceArtifactPath = path.join(repo, 'atomic_workbench', 'evidence', 'ATM-GOV-IMPERSONATE.json');
  mkdirSync(path.dirname(staticEvidenceArtifactPath), { recursive: true });
  writeFileSync(staticEvidenceArtifactPath, `${JSON.stringify({ status: 'done', summary: 'handwritten static evidence' }, null, 2)}\n`, 'utf8');
  assert(runGit(repo, ['add', 'atomic_workbench/evidence/ATM-GOV-IMPERSONATE.json']).exitCode === 0, 'static evidence impersonation fixture must be stageable');
  const staticEvidencePreCommit = runAtm(['hook', 'pre-commit', '--cwd', repo, '--json']);
  assert(staticEvidencePreCommit.exitCode === 1, 'pre-commit must fail for static evidence impersonation without CLI evidence context');
  assert(staticEvidencePreCommit.parsed.ok === false, 'pre-commit must report ok=false for static evidence impersonation');
  assert((staticEvidencePreCommit.parsed.evidence?.protectedStateReport?.findings ?? []).some((entry: any) => entry.reason === 'static-evidence-artifact-without-cli-context'), 'pre-commit must report the static evidence impersonation finding');
  assert(runGit(repo, ['rm', '--cached', '--force', '--quiet', 'atomic_workbench/evidence/ATM-GOV-IMPERSONATE.json']).exitCode === 0, 'static evidence impersonation fixture must be removable from index');
  rmSync(staticEvidenceArtifactPath, { force: true });

  const closeTask = runAtm(['tasks', 'close', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--status', 'done', '--json']);
  assert(closeTask.exitCode === 0, 'tasks close done must exit 0 with evidence');
  assert(closeTask.parsed.ok === true, 'tasks close done must report ok=true with evidence');
  const closedTask = JSON.parse(readFileSync(taskPath, 'utf8'));
  const closeTransitionId = String(closedTask.lastTransitionId ?? '');
  assert(closeTransitionId.length > 0, 'tasks close done must persist lastTransitionId');
  const closeTransitionPath = path.join(repo, '.atm', 'history', 'task-events', 'ATM-GOV-0103', `${closeTransitionId}.json`);
  assert(existsSync(closeTransitionPath), 'tasks close done must write a closure transition event');
  const closeTransition = JSON.parse(readFileSync(closeTransitionPath, 'utf8'));
  assert(closeTransition.closure === undefined, 'host-repo closure transition should not fabricate framework closure metadata');

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
  console.log('[governance-commands:' + mode + '] ok (lock, budget, guard, evidence, git governance, and full claim lifecycle commands verified)');
}

function existsSyncPortable(repositoryRoot: any, relativePath: any) {
  return path.isAbsolute(relativePath)
    ? existsSync(path.resolve(relativePath))
    : existsSync(path.join(repositoryRoot, relativePath));
}
