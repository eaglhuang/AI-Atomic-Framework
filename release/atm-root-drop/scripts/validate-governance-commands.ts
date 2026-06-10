import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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

function runAtm(args: any, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.dev.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env }
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

function sha256(buffer: Buffer | string) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function writeHistoricalRestorePacket(repo: string, taskId: string, options: { status?: string; owner?: string } = {}) {
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  const evidencePath = path.join(repo, '.atm', 'history', 'evidence', `${taskId}.json`);
  const closurePacketPath = path.join(repo, '.atm', 'history', 'evidence', `${taskId}.closure-packet.json`);
  const eventId = `2026-01-02T00-00-00-000Z-close-${taskId.toLowerCase()}`;
  const eventPath = path.join(repo, '.atm', 'history', 'task-events', taskId, `${eventId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  mkdirSync(path.dirname(eventPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Historical ledger restore fixture',
    status: options.status ?? 'done',
    owner: options.owner ?? 'legacy-agent',
    lastTransitionId: eventId,
    lastTransitionAt: '2026-01-02T00:00:00.000Z',
    closedAt: '2026-01-02T00:00:00.000Z',
    closedByActor: 'legacy-agent',
    closedBySessionId: 'session-legacy-restore',
    claim: {
      actorId: 'legacy-agent',
      leaseId: 'lease-legacy-restore',
      state: 'active'
    }
  }, null, 2)}\n`, 'utf8');
  writeFileSync(evidencePath, `${JSON.stringify({
    taskId,
    updatedAt: '2026-01-02T00:00:00.000Z',
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'historical restore fixture evidence',
        producedBy: 'legacy-agent',
        sessionId: 'session-legacy-restore',
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    ]
  }, null, 2)}\n`, 'utf8');
  writeFileSync(closurePacketPath, `${JSON.stringify({
    schemaId: 'atm.closurePacket.v1',
    specVersion: '0.1.0',
    taskId,
    targetCommit: '0123456789abcdef0123456789abcdef01234567',
    evidencePath: `.atm/history/evidence/${taskId}.json`,
    closedAt: '2026-01-02T00:00:00.000Z',
    closedByActor: 'legacy-agent'
  }, null, 2)}\n`, 'utf8');
  writeFileSync(eventPath, `${JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    specVersion: '0.1.0',
    transitionId: eventId,
    taskId,
    action: 'close',
    actorId: 'legacy-agent',
    fromStatus: 'running',
    toStatus: options.status ?? 'done',
    taskPath: `.atm/history/tasks/${taskId}.json`,
    taskSha256: sha256(readFileSync(taskPath)),
    createdAt: '2026-01-02T00:00:00.000Z',
    command: `node atm.mjs tasks close --task ${taskId} --actor legacy-agent --status done --json`
  }, null, 2)}\n`, 'utf8');
  return [
    `.atm/history/tasks/${taskId}.json`,
    `.atm/history/evidence/${taskId}.json`,
    `.atm/history/evidence/${taskId}.closure-packet.json`,
    `.atm/history/task-events/${taskId}/${eventId}.json`
  ];
}

function makeHostRepo(parent: string, name: string, config: Record<string, unknown> = {}) {
  const repo = path.join(parent, name);
  mkdirSync(repo, { recursive: true });
  writeJson(path.join(repo, 'package.json'), { name, type: 'module' });
  writeJson(path.join(repo, '.atm', 'config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: {
      tasks: '.atm/history/tasks',
      taskEvents: '.atm/history/task-events'
    },
    taskLedger: {
      enabled: true,
      mode: 'auto',
      mirrorExternalTasks: true,
      requireCliTransitions: true,
      provider: 'atm-local',
      ...(config.taskLedger as Record<string, unknown> | undefined ?? {})
    }
  });
  return repo;
}

function initGitRepo(repo: string) {
  const init = runGit(repo, ['init']);
  assert(init.exitCode === 0, 'fixture git init must succeed');
  assert(runGit(repo, ['config', 'user.name', 'bootstrap']).exitCode === 0, 'fixture git user.name must be configured');
  assert(runGit(repo, ['config', 'user.email', 'bootstrap@example.com']).exitCode === 0, 'fixture git user.email must be configured');
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
  const claimSessionId = String(nextClaim.parsed.evidence.claimResult?.sessionId ?? nextClaim.parsed.evidence.claimResult?.session?.sessionId ?? '');
  assert(claimSessionId.length > 0, 'next --claim must produce a session id');

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
  assert(runGit(repo, ['config', 'user.name', 'fixture-agent']).exitCode === 0, 'fixture git user.name must match the registered actor before governed commits');
  assert(runGit(repo, ['config', 'user.email', 'fixture-agent@example.com']).exitCode === 0, 'fixture git user.email must match the registered actor before governed commits');

  const explicitIdentityPrepare = runAtm([
    'git',
    'prepare',
    '--cwd',
    repo,
    '--actor',
    'prepare-only-agent',
    '--name',
    'Prepare Only',
    '--email',
    'prepare-only@example.com',
    '--json'
  ]);
  assert(explicitIdentityPrepare.exitCode === 0, 'git prepare with explicit name/email must exit 0');
  assert(explicitIdentityPrepare.parsed.ok === true, 'git prepare with explicit name/email must report ok=true');
  assert(explicitIdentityPrepare.parsed.evidence?.identityPath === '.atm/runtime/identity/default.json', 'explicit git prepare must report the runtime identity path');
  const preparedIdentity = JSON.parse(readFileSync(path.join(repo, '.atm', 'runtime', 'identity', 'default.json'), 'utf8'));
  assert(preparedIdentity.actorId === 'prepare-only-agent', 'explicit git prepare must seed the runtime identity actor');
  assert(preparedIdentity.gitName === 'Prepare Only', 'explicit git prepare must seed the runtime identity git name');
  assert(preparedIdentity.gitEmail === 'prepare-only@example.com', 'explicit git prepare must seed the runtime identity git email');

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
    `ATM-Session: ${claimSessionId}`,
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

  const claimSessionPath = path.join(repo, '.atm', 'runtime', 'sessions', `${claimSessionId}.json`);
  const closedClaimSession = JSON.parse(readFileSync(claimSessionPath, 'utf8'));
  closedClaimSession.status = 'closed';
  closedClaimSession.closedAt = '2026-01-01T00:00:00.000Z';
  closedClaimSession.updatedAt = '2026-01-01T00:00:00.000Z';
  writeFileSync(claimSessionPath, `${JSON.stringify(closedClaimSession, null, 2)}\n`, 'utf8');
  const tasklessFile = path.join(repo, 'notes', 'taskless.txt');
  writeFileSync(tasklessFile, 'taskless fixture\n', 'utf8');
  assert(runGit(repo, ['add', 'notes/taskless.txt']).exitCode === 0, 'taskless fixture must stage');
  assert(runGit(repo, ['commit', '--no-verify', '-m', ['chore: taskless fixture', '', 'ATM-Actor: fixture-agent'].join('\n')]).exitCode === 0, 'taskless fixture commit must succeed');
  const tasklessGitCheck = runAtm(['git', 'check', '--cwd', repo, '--actor', 'fixture-agent', '--json']);
  assert(tasklessGitCheck.exitCode === 0, 'actor-only git check must not inherit a closed prior session');
  assert(tasklessGitCheck.parsed.ok === true, 'actor-only git check must pass with actor-only trailers when no task is supplied');
  assert(tasklessGitCheck.parsed.evidence?.taskId === null, 'actor-only git check must not infer a task from closed session history');
  assert(tasklessGitCheck.parsed.evidence?.sessionId === null, 'actor-only git check must not infer a closed session');
  const tasklessGitPrepare = runAtm(['git', 'prepare', '--cwd', repo, '--actor', 'fixture-agent', '--json']);
  assert(tasklessGitPrepare.exitCode === 0, 'actor-only git prepare must exit 0');
  assert(!(tasklessGitPrepare.parsed.evidence?.trailerHints ?? []).some((entry: string) => entry.startsWith('ATM-Session: ')), 'actor-only git prepare must not suggest a stale closed session trailer');

  const mirrorTaskId = 'ATM-GOV-MIRROR';
  const mirrorTaskPath = path.join(repo, '.atm', 'history', 'tasks', `${mirrorTaskId}.json`);
  const mirrorEventId = '2026-01-01T00-00-00-000Z-import-fixture';
  const mirrorEventPath = path.join(repo, '.atm', 'history', 'task-events', mirrorTaskId, `${mirrorEventId}.json`);
  const mirrorReportPath = path.join(repo, '.atm', 'history', 'reports', 'task-import', '2026-01-01T00-00-00-000Z.json');
  mkdirSync(path.dirname(mirrorTaskPath), { recursive: true });
  mkdirSync(path.dirname(mirrorEventPath), { recursive: true });
  mkdirSync(path.dirname(mirrorReportPath), { recursive: true });
  writeFileSync(mirrorTaskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: mirrorTaskId,
    title: 'Mirror sync fixture',
    status: 'done',
    lastTransitionId: mirrorEventId,
    lastTransitionAt: '2026-01-01T00:00:00.000Z',
    closureAuthority: 'planning_repo',
    targetRepo: 'Fixture',
    source: { planPath: '../planning/tasks/mirror.task.md' }
  }, null, 2)}\n`, 'utf8');
  writeFileSync(mirrorEventPath, `${JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    specVersion: '0.1.0',
    transitionId: mirrorEventId,
    taskId: mirrorTaskId,
    action: 'import',
    actorId: 'fixture-agent',
    fromStatus: null,
    toStatus: 'done',
    taskPath: `.atm/history/tasks/${mirrorTaskId}.json`,
    taskSha256: sha256(readFileSync(mirrorTaskPath)),
    createdAt: '2026-01-01T00:00:00.000Z',
    command: 'node atm.mjs tasks import --write --force --json'
  }, null, 2)}\n`, 'utf8');
  writeFileSync(mirrorReportPath, `${JSON.stringify({
    schemaId: 'atm.taskImportReport.v1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    manifest: {
      mode: 'write',
      tasks: [{ workItemId: mirrorTaskId }]
    }
  }, null, 2)}\n`, 'utf8');
  assert(runGit(repo, ['add', `.atm/history/tasks/${mirrorTaskId}.json`, `.atm/history/task-events/${mirrorTaskId}/${mirrorEventId}.json`, '.atm/history/reports/task-import/2026-01-01T00-00-00-000Z.json']).exitCode === 0, 'mirror-sync fixture artifacts must stage');
  const mirrorSyncCommit = runAtm(['git', 'commit', '--cwd', repo, '--actor', 'fixture-agent', '--task', mirrorTaskId, '--message', 'atm: sync mirror fixture', '--json']);
  assert(mirrorSyncCommit.exitCode === 0, 'mirror-sync-only git commit must not require a fake claim or stale session');
  assert(mirrorSyncCommit.parsed.ok === true, 'mirror-sync-only git commit must report ok=true');
  assert(mirrorSyncCommit.parsed.evidence?.sessionId === null, 'mirror-sync-only git commit must not inherit a closed session');
  assert(!(mirrorSyncCommit.parsed.evidence?.trailers ?? []).some((entry: string) => entry.startsWith('ATM-Session: ')), 'mirror-sync-only git commit must not write a stale session trailer');
  rmSync(mirrorTaskPath, { force: true });
  rmSync(path.dirname(mirrorEventPath), { recursive: true, force: true });
  rmSync(mirrorReportPath, { force: true });

  const restoreTaskId = 'ATM-GOV-RESTORE';
  const restoreFiles = writeHistoricalRestorePacket(repo, restoreTaskId);
  assert(runGit(repo, ['add', ...restoreFiles]).exitCode === 0, 'historical ledger restore packet must stage');
  const restoreCheck = runAtm(['git', 'check', '--cwd', repo, '--actor', 'fixture-agent', '--task', restoreTaskId, '--no-trailers', '--json']);
  assert(restoreCheck.exitCode === 0, 'historical ledger restore git check must accept a complete staged restore packet');
  assert(restoreCheck.parsed.ok === true, 'historical ledger restore git check must report ok=true');
  assert(restoreCheck.parsed.evidence?.sessionId === null, 'historical ledger restore git check must not require a legacy session');
  const restoreCommit = runAtm(['git', 'commit', '--cwd', repo, '--actor', 'fixture-agent', '--task', restoreTaskId, '--message', 'atm: restore closed ledger packet', '--json']);
  assert(restoreCommit.exitCode === 0, 'historical ledger restore git commit must not require a fake legacy claim or session');
  assert(restoreCommit.parsed.ok === true, 'historical ledger restore git commit must report ok=true');
  assert(restoreCommit.parsed.evidence?.sessionId === null, 'historical ledger restore git commit must not inherit a legacy session');
  assert(!(restoreCommit.parsed.evidence?.trailers ?? []).some((entry: string) => entry.startsWith('ATM-Session: ') || entry.startsWith('ATM-Claim: ')), 'historical ledger restore must not write stale claim or session trailers');

  const reconcileTaskId = 'ATM-GOV-RECONCILE';
  const reconcileReserve = runAtm(['tasks', 'reserve', '--cwd', repo, '--task', reconcileTaskId, '--actor', 'fixture-agent', '--title', 'Reconcile close window regression', '--json']);
  assert(reconcileReserve.exitCode === 0, 'reconcile fixture reserve must exit 0');
  const reconcilePromote = runAtm(['tasks', 'promote', '--cwd', repo, '--task', reconcileTaskId, '--actor', 'fixture-agent', '--json']);
  assert(reconcilePromote.exitCode === 0, 'reconcile fixture promote must exit 0');
  const reconcileSourcePath = path.join(repo, 'src', 'reconcile-close-window.ts');
  mkdirSync(path.dirname(reconcileSourcePath), { recursive: true });
  writeFileSync(reconcileSourcePath, 'export const reconcileCloseWindow = true;\n', 'utf8');
  const reconcileClaim = runAtm(['tasks', 'claim', '--cwd', repo, '--task', reconcileTaskId, '--actor', 'fixture-agent', '--files', 'src/reconcile-close-window.ts', '--json']);
  assert(reconcileClaim.exitCode === 0, 'reconcile fixture claim must exit 0');
  assert(runGit(repo, ['add', 'src/reconcile-close-window.ts']).exitCode === 0, 'reconcile fixture source file must stage');
  const reconcileDeliveryCommit = runAtm(['git', 'commit', '--cwd', repo, '--actor', 'fixture-agent', '--task', reconcileTaskId, '--message', 'feat: reconcile delivery fixture', '--json']);
  assert(reconcileDeliveryCommit.exitCode === 0, 'reconcile fixture delivery commit must exit 0');
  const reconcileDeliverySha = String(reconcileDeliveryCommit.parsed.evidence?.commitSha ?? '');
  assert(reconcileDeliverySha.length > 0, 'reconcile fixture delivery commit must return commit sha');
  const reconcileClose = runAtm(['tasks', 'reconcile', '--cwd', repo, '--task', reconcileTaskId, '--actor', 'fixture-agent', '--delivery-commit', reconcileDeliverySha, '--json']);
  assert(reconcileClose.exitCode === 0, 'tasks reconcile must exit 0 for close-commit-window regression fixture');
  assert(reconcileClose.parsed.ok === true, 'tasks reconcile must report ok=true for close-commit-window regression fixture');
  const reconcileCommit = runAtm(['git', 'commit', '--cwd', repo, '--actor', 'fixture-agent', '--task', reconcileTaskId, '--message', 'chore: reconcile closure packet commit', '--json']);
  assert(reconcileCommit.exitCode === 0, 'close-commit-window reconcile packet must commit without reopening a dead session');
  assert(reconcileCommit.parsed.ok === true, 'close-commit-window reconcile packet commit must report ok=true');
  assert(reconcileCommit.parsed.evidence?.sessionId === null, 'close-commit-window reconcile packet commit must not require a revived session');
  assert(!(reconcileCommit.parsed.evidence?.trailers ?? []).some((entry: string) => entry.startsWith('ATM-Session: ') || entry.startsWith('ATM-Claim: ')), 'close-commit-window reconcile packet commit must not write stale claim or session trailers');

  const mixedRestoreTaskId = 'ATM-GOV-RESTORE-MIXED';
  const mixedRestoreFiles = writeHistoricalRestorePacket(repo, mixedRestoreTaskId);
  const mixedSourcePath = path.join(repo, 'src', 'restore-bypass.ts');
  mkdirSync(path.dirname(mixedSourcePath), { recursive: true });
  writeFileSync(mixedSourcePath, 'export const restoreBypass = true;\n', 'utf8');
  assert(runGit(repo, ['add', ...mixedRestoreFiles, 'src/restore-bypass.ts']).exitCode === 0, 'mixed historical restore fixture must stage');
  const mixedRestoreCommit = runAtm(['git', 'commit', '--cwd', repo, '--actor', 'fixture-agent', '--task', mixedRestoreTaskId, '--message', 'atm: reject mixed restore packet', '--json']);
  assert(mixedRestoreCommit.exitCode === 1, 'historical ledger restore must reject packets mixed with source files');
  assert(mixedRestoreCommit.parsed.messages?.[0]?.code === 'ATM_GIT_COMMIT_SESSION_REQUIRED', 'mixed restore packet must fall back to normal active-task session enforcement');
  runGit(repo, ['reset', '--mixed', 'HEAD']);
  rmSync(mixedSourcePath, { force: true });

  const openRestoreTaskId = 'ATM-GOV-RESTORE-OPEN';
  const openRestoreFiles = writeHistoricalRestorePacket(repo, openRestoreTaskId, { status: 'running' });
  assert(runGit(repo, ['add', ...openRestoreFiles]).exitCode === 0, 'non-done restore fixture must stage');
  writeHistoricalRestorePacket(repo, openRestoreTaskId, { status: 'done' });
  const openRestoreCheck = runAtm(['git', 'check', '--cwd', repo, '--actor', 'fixture-agent', '--task', openRestoreTaskId, '--no-trailers', '--json']);
  assert(openRestoreCheck.exitCode === 0 || openRestoreCheck.exitCode === 1, 'non-done staged restore git check must return a governance result');
  assert(openRestoreCheck.parsed.ok === false, 'git check must reject non-done staged restore packets even if the working tree was later edited to done');
  assert((openRestoreCheck.parsed.evidence?.violations ?? []).some((entry: any) => entry.code === 'task-owner-mismatch' || entry.code === 'claim-owner-mismatch'), 'rejected non-done staged restore git check must fall back to normal owner/claim governance');
  const openRestoreCommit = runAtm(['git', 'commit', '--cwd', repo, '--actor', 'fixture-agent', '--task', openRestoreTaskId, '--message', 'atm: reject open restore packet', '--json']);
  assert(openRestoreCommit.exitCode === 1, 'historical ledger restore must reject non-done staged task ledgers');
  assert(openRestoreCommit.parsed.messages?.[0]?.code === 'ATM_GIT_COMMIT_SESSION_REQUIRED', 'non-done restore packet must fall back to normal active-task session enforcement');
  runGit(repo, ['reset', '--mixed', 'HEAD']);

  assert(runGit(repo, ['config', 'user.name', 'Missing Identity']).exitCode === 0, 'fixture git user.name must be configurable for identity repair command validation');
  assert(runGit(repo, ['config', 'user.email', 'missing-identity@example.com']).exitCode === 0, 'fixture git user.email must be configurable for identity repair command validation');
  const expectedIdentitySetCommand = 'node atm.mjs identity set --actor "missing-identity-agent" --git-name "Missing Identity" --git-email "missing-identity@example.com" --json';
  const missingIdentityCommit = runAtm(['git', 'commit', '--cwd', repo, '--actor', 'missing-identity-agent', '--message', 'chore: blocked missing identity', '--json']);
  assert(missingIdentityCommit.exitCode === 2, 'git commit must fail before committing when the actor identity profile is missing');
  assert(missingIdentityCommit.parsed.messages?.[0]?.data?.requiredCommand === expectedIdentitySetCommand, 'git commit missing identity must return a runnable identity set command from repo-local git config');
  const missingIdentityPreCommit = runAtm(['hook', 'pre-commit', '--cwd', repo, '--json'], {
    ATM_COMMIT_ACTOR_ID: 'missing-identity-agent'
  });
  assert(missingIdentityPreCommit.exitCode === 1, 'pre-commit must fail when ATM commit actor has no identity profile');
  assert((missingIdentityPreCommit.parsed.evidence?.commitAttributionReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_COMMIT_IDENTITY_PROFILE_MISSING' && entry.requiredCommand === expectedIdentitySetCommand), 'pre-commit missing identity finding must return a runnable identity set command from repo-local git config');
  const gitPrepareAfterMissingIdentityCheck = runAtm(['git', 'prepare', '--cwd', repo, '--task', 'ATM-GOV-0103', '--actor', 'fixture-agent', '--json']);
  assert(gitPrepareAfterMissingIdentityCheck.exitCode === 0, 'git prepare must restore fixture git identity after missing identity repair command validation');
  assert(gitPrepareAfterMissingIdentityCheck.parsed.ok === true, 'git prepare restore must report ok=true');

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
    'typecheck,validate:cli,validate:git-head-evidence',
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

  const historicalDeliveryPath = path.join(repo, 'src', 'historical-delivery.ts');
  mkdirSync(path.dirname(historicalDeliveryPath), { recursive: true });
  writeFileSync(historicalDeliveryPath, 'export const historicalDeliveryFixture = true;\n', 'utf8');
  assert(runGit(repo, ['add', 'src/historical-delivery.ts']).exitCode === 0, 'historical delivery fixture must be stageable');
  assert(runGit(repo, ['commit', '-m', 'feat: historical delivery fixture']).exitCode === 0, 'historical delivery fixture commit must succeed');
  const historicalDeliveryCommit = runGit(repo, ['rev-parse', 'HEAD']).stdout;
  assert(historicalDeliveryCommit.length > 0, 'historical delivery fixture commit sha must be available');

  const historicalReserve = runAtm(['tasks', 'reserve', '--cwd', repo, '--task', 'ATM-GOV-0111', '--actor', 'fixture-agent', '--title', 'Historical delivery code close test', '--json']);
  assert(historicalReserve.exitCode === 0, 'historical delivery tasks reserve must exit 0');
  const historicalPromote = runAtm(['tasks', 'promote', '--cwd', repo, '--task', 'ATM-GOV-0111', '--actor', 'fixture-agent', '--json']);
  assert(historicalPromote.exitCode === 0, 'historical delivery tasks promote must exit 0');
  const historicalTaskPath = path.join(repo, '.atm', 'history', 'tasks', 'ATM-GOV-0111.json');
  const historicalTaskDocument = JSON.parse(readFileSync(historicalTaskPath, 'utf8'));
  historicalTaskDocument.scopePaths = ['src/historical-delivery.ts'];
  historicalTaskDocument.deliverables = ['src/historical-delivery.ts'];
  writeFileSync(historicalTaskPath, `${JSON.stringify(historicalTaskDocument, null, 2)}\n`, 'utf8');
  const historicalClaim = runAtm(['next', '--cwd', repo, '--claim', '--actor', 'fixture-agent', '--prompt', 'ATM-GOV-0111', '--json']);
  assert(historicalClaim.exitCode === 0, 'historical delivery next --claim must exit 0');
  const historicalEvidence = runAtm([
    'evidence',
    'add',
    '--cwd',
    repo,
    '--task',
    'ATM-GOV-0111',
    '--actor',
    'fixture-agent',
    '--kind',
    'test',
    '--summary',
    'historical delivery commit verified',
    '--artifacts',
    'src/historical-delivery.ts',
    '--freshness',
    'fresh',
    '--command',
    'npm run typecheck',
    '--exit-code',
    '0',
    '--stdout-sha256',
    'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    '--stderr-sha256',
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '--validators',
    'typecheck,validate:cli,validate:git-head-evidence',
    '--json'
  ]);
  assert(historicalEvidence.exitCode === 0, 'historical delivery evidence add must exit 0');
  const historicalCloseWithoutCommit = runAtm(['tasks', 'close', '--cwd', repo, '--task', 'ATM-GOV-0111', '--actor', 'fixture-agent', '--status', 'done', '--json']);
  assert(historicalCloseWithoutCommit.exitCode === 1, 'historical delivery close without a delivery commit must fail when there is no current deliverable diff');
  assert(historicalCloseWithoutCommit.parsed.messages?.[0]?.code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED', 'historical delivery close without commit must report deliverable diff requirement');
  const historicalClose = runAtm(['tasks', 'close', '--cwd', repo, '--task', 'ATM-GOV-0111', '--actor', 'fixture-agent', '--status', 'done', '--historical-delivery', historicalDeliveryCommit, '--json']);
  assert(historicalClose.exitCode === 0, 'historical delivery close with a scoped delivery commit must exit 0');
  assert(historicalClose.parsed.ok === true, 'historical delivery close with a scoped delivery commit must report ok=true');
  const historicalCloseGate = historicalClose.parsed.evidence?.deliverableGate ?? {};
  assert(historicalCloseGate.reason === 'historical-delivery-diff-present', 'historical delivery close must report historical-delivery-diff-present');
  assert((historicalCloseGate.deliverableFiles ?? []).includes('src/historical-delivery.ts'), 'historical delivery close must include scoped historical deliverable file');
  assert(runGit(repo, ['reset', '--hard', 'HEAD']).exitCode === 0, 'historical delivery close fixture must restore tracked files after staged close artifacts validation');
  assert(runGit(repo, ['clean', '-fd', '--', '.atm/history/task-events/ATM-GOV-0111', '.atm/history/evidence/ATM-GOV-0111.closure-packet.json']).exitCode === 0, 'historical delivery close fixture must clean untracked close artifacts after validation');

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

  const residueRepo = makeHostRepo(tempRoot, 'residue-status-fixture');
  initGitRepo(residueRepo);
  const residuePlanPath = path.join(residueRepo, 'docs', 'fixtures', 'ATM-GOV-RESIDUE-0001.task.md');
  mkdirSync(path.dirname(residuePlanPath), { recursive: true });
  writeFileSync(residuePlanPath, [
    '---',
    'task_id: ATM-GOV-RESIDUE-0001',
    'title: "Residue status fixture"',
    'status: done',
    '---',
    '# ATM-GOV-RESIDUE-0001',
    ''
  ].join('\n'), 'utf8');
  writeJson(path.join(residueRepo, '.atm', 'history', 'tasks', 'ATM-GOV-RESIDUE-0001.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'ATM-GOV-RESIDUE-0001',
    title: 'Residue status fixture',
    status: 'running',
    planningRepo: '3KLife',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    closedAt: '2026-06-10T00:00:00.000Z',
    closurePacket: '.atm/history/evidence/ATM-GOV-RESIDUE-0001.closure-packet.json',
    claim: {
      actorId: 'fixture-agent',
      leaseId: 'lease-residue-0001',
      state: 'active'
    },
    source: {
      planPath: residuePlanPath,
      sectionTitle: 'ATM-GOV-RESIDUE-0001',
      headingLine: 1,
      hash: 'residue-status-fixture'
    }
  });
  const residueStatus = runAtm(['tasks', 'status', '--cwd', residueRepo, '--task', 'ATM-GOV-RESIDUE-0001', '--json']);
  assert(residueStatus.exitCode === 0, 'tasks status residue fixture must exit 0');
  assert(residueStatus.parsed.ok === true, 'tasks status residue fixture must report ok=true');
  assert(residueStatus.parsed.evidence.residueClassification.bucket === 'complete-but-unfinalized', 'tasks status residue fixture must classify complete-but-unfinalized');
  assert(String(residueStatus.parsed.evidence.residueClassification.nextCommand ?? '').includes('tasks reconcile'), 'tasks status residue fixture must point to reconcile');
  assert(String(residueStatus.parsed.evidence.residueClassification.nextCommand ?? '').includes('ATM-GOV-RESIDUE-0001'), 'tasks status residue fixture must materialize task id in next command');

  const residueFinalize = runAtm(['tasks', 'finalize', 'diagnose', '--cwd', residueRepo, '--task', 'ATM-GOV-RESIDUE-0001', '--json']);
  assert(residueFinalize.exitCode === 0, 'tasks finalize diagnose residue fixture must exit 0');
  assert(residueFinalize.parsed.evidence.schemaId === 'atm.taskResidueDiagnosis.v1', 'tasks finalize diagnose must emit atm.taskResidueDiagnosis.v1');
  assert(residueFinalize.parsed.evidence.bucket === 'complete-but-unfinalized', 'tasks finalize diagnose must classify complete-but-unfinalized');
  assert(residueFinalize.parsed.evidence.autoMutationAllowed === false, 'tasks finalize diagnose must not allow auto mutation');

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
  if (closeTransition.closure) {
    assert(closeTransition.closure.closurePacketPath === null, 'host-repo closure transition must not fabricate a framework closure packet');
    assert((closeTransition.closure.requiredGates ?? []).length === 0, 'host-repo closure transition must not fabricate framework required gates');
    assert((closeTransition.closure.validationPasses ?? []).length === 0, 'host-repo closure transition must not fabricate framework validation passes');
  }

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
