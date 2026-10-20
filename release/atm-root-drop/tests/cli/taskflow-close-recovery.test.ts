import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isRegularPayloadFile } from '../../packages/cli/src/commands/taskflow/commit-bundle-assembly.ts';
import { inspectCloseHolderLiveness } from '../../packages/cli/src/commands/tasks/close-holder-liveness.ts';

// #373: an interrupted `taskflow close --write` must be recoverable through a
// governed lane, never by hand-editing .atm state. Two real incidents shape the
// fixtures: TASK-PRF-0138 (close landed by later commits, lock left behind) and
// TASK-PRF-0140 (died after the ledger write with the bundle half staged, then
// `tasks renew` flipped the working ledger back to running).
const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicCli = pathToFileURL(path.join(repoRootDir, 'packages', 'cli', 'src', 'atm-public.ts')).href;
const env: NodeJS.ProcessEnv = { ...process.env, ATM_CLOSE_RECOVERY_STALE_AFTER_MS: '0' };
delete env.ATM_LANE_SESSION_ID;
delete env.ATM_ACTOR_ID;

function atm(cwd: string, args: string[]) {
  const script = `const { runPublicCli } = await import(${JSON.stringify(publicCli)}); process.exitCode = await runPublicCli(JSON.parse(process.argv[1]));`;
  const run = spawnSync(process.execPath, ['--strip-types', '--input-type=module', '-e', script, JSON.stringify([...args, '--cwd', cwd, '--json'])], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ''}`;
  const start = out.indexOf('{');
  assert.ok(start >= 0, `no JSON from atm ${args.join(' ')}:\n${out}\n${run.stderr}`);
  return { exitCode: run.status, json: JSON.parse(out.slice(start)) as Record<string, any> };
}
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const codes = (result: { json: Record<string, any> }) => (result.json.messages ?? []).map((entry: { code: string }) => entry.code);
function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
const deadPid = spawnSync(process.execPath, ['-e', '']).pid!;
const T0 = new Date(Date.now() - 10 * 60_000);
const iso = (offsetMs: number) => new Date(T0.getTime() + offsetMs).toISOString();
const eventId = (offsetMs: number, action: string, suffix: string) => `${iso(offsetMs).replace(/[:.]/g, '-')}-${action}-${suffix}`;

const CARD = `---\ntask_id: TASK-REC-0001\ntitle: 'Recovery fixture'\nstatus: planned\nowner: fixture-bot\n---\n\n# TASK-REC-0001\n`;
const CARD_CLOSED = CARD.replace('status: planned', 'status: done').replace('owner: fixture-bot\n', `owner: fixture-bot\ncompleted_at: "${iso(250)}"\ncompleted_by_agent: "fixture-bot"\nclosedAt: "${iso(250)}"\nclosedByActor: "fixture-bot"\nclosedByCommand: atm tasks close\nlastTransitionId: "x"\nlastTransitionAt: "${iso(250)}"\nledgerContractVersion: task-ledger/v1\ndelivery_commit: "${'a'.repeat(40)}"\n`);

function fixture(name: string) {
  const cwd = path.join(tempRoot, name);
  const taskId = 'TASK-REC-0001';
  mkdirSync(cwd, { recursive: true });
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'ATM Fixture']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  writeJson(path.join(cwd, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1', layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  mkdirSync(path.join(cwd, '.atm/task-plans'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm/task-plans', `${taskId}.md`), CARD, 'utf8');
  const claimEvent = eventId(-60_000, 'claim', 'c1');
  writeJson(path.join(cwd, '.atm/history/task-events', taskId, `${claimEvent}.json`), { transitionId: claimEvent, action: 'claim', fromStatus: 'ready', toStatus: 'running', taskPath: `.atm/history/tasks/${taskId}.json`, createdAt: iso(-60_000) });
  const ledger = {
    schemaVersion: 'atm.workItem.v0.2', workItemId: taskId, title: 'Recovery fixture', status: 'running',
    source: { planPath: `.atm/task-plans/${taskId}.md`, planningSourceSeal: { schemaId: 'atm.planningSourceSeal.v1', taskCardPath: `.atm/task-plans/${taskId}.md`, planningCommitSha: null, contentDigest: sha(CARD), amendmentEpoch: 0 } },
    claim: { actorId: 'fixture-bot', leaseId: 'lease-fixture', claimedAt: iso(-60_000), heartbeatAt: iso(-60_000), ttlSeconds: 1800, files: [], state: 'active' },
    lastTransitionId: claimEvent, lastTransitionAt: iso(-60_000)
  };
  writeJson(path.join(cwd, '.atm/history/tasks', `${taskId}.json`), ledger);
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'bootstrap']);
  // What an interrupted close leaves in .atm/runtime: an in-progress
  // transaction, the close-window lock, and the holder's close mutex lease.
  writeJson(path.join(cwd, '.atm/runtime/close-transactions', `${taskId}.json`), { schemaId: 'atm.closeTransactionStatus.v1', taskId, phase: 'ledger-written', outcome: 'in-progress', startedAt: iso(0), updatedAt: iso(200), ledgerCommit: null, targetCommit: null, planningCommit: null, cleanupComplete: false, recoveryCommand: '', failure: null });
  writeJson(path.join(cwd, '.atm/runtime/locks/close-window-staged-index.lock.json'), { schemaId: 'atm.closeWindowStagedIndexLock.v1', specVersion: '0.1.0', taskId, actorId: 'fixture-bot', acquiredAt: iso(-1000), status: 'active', expectedStageFiles: [], foreignStagedSnapshotPath: null, foreignStagedEntries: [], provenResidueEntries: [], unexpectedStagedTasks: [], releasedAt: null, releaseOutcome: null });
  const setHolder = (pid: number) => writeJson(path.join(cwd, '.atm/runtime/close-transactions', `${taskId}.lock.json`), { schemaId: 'atm.closeTransactionMutexLease.v1', taskId, actorId: 'fixture-bot', leaseId: `close-${taskId}-1-${pid}`, ownerPid: pid, acquiredAt: iso(300), expiresAt: iso(450_300), ttlMs: 450000 });
  setHolder(deadPid);
  const closeEvent = eventId(100, 'close', 'e1');
  const cardEvent = eventId(250, 'close', 'e2');
  const closedLedger = { ...ledger, status: 'done', closedAt: iso(0), closedByActor: 'fixture-bot', closurePacket: `.atm/history/evidence/${taskId}.closure-packet.json`, claim: { ...ledger.claim, state: 'released', reason: 'closed' }, lastTransitionId: closeEvent, lastTransitionAt: iso(100) };
  const writeClose = () => {
    writeJson(path.join(cwd, '.atm/history/task-events', taskId, `${closeEvent}.json`), { transitionId: closeEvent, action: 'close', fromStatus: 'running', toStatus: 'done', taskPath: `.atm/history/tasks/${taskId}.json`, createdAt: iso(100) });
    writeJson(path.join(cwd, '.atm/history/task-events', taskId, `${cardEvent}.json`), { transitionId: cardEvent, action: 'close', fromStatus: 'planned', toStatus: 'done', taskPath: `.atm/task-plans/${taskId}.md`, createdAt: iso(250) });
    writeJson(path.join(cwd, '.atm/history/evidence', `${taskId}.closure-packet.json`), { schemaId: 'fixture.closurePacket', taskId });
    writeJson(path.join(cwd, '.atm/history/tasks', `${taskId}.json`), closedLedger);
    writeFileSync(path.join(cwd, '.atm/task-plans', `${taskId}.md`), CARD_CLOSED, 'utf8');
  };
  return { cwd, taskId, ledger, closedLedger, closeEvent, cardEvent, claimEvent, setHolder, writeClose };
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-close-recovery-'));
try {
  // Liveness: a gone owner pid is dead even inside the stale window; a live pid never is.
  const liveness = fixture('liveness');
  assert.equal(inspectCloseHolderLiveness({ cwd: liveness.cwd, taskId: liveness.taskId, lockAcquiredAt: new Date().toISOString(), staleAfterMs: 60_000 }).reason, 'owner-pid-gone');
  liveness.setHolder(process.pid);
  assert.equal(inspectCloseHolderLiveness({ cwd: liveness.cwd, taskId: liveness.taskId, lockAcquiredAt: iso(0), staleAfterMs: 0 }).alive, true);

  // Case 0138: close landed through later commits, lock and transaction left behind.
  {
    const f = fixture('landed-0138');
    f.writeClose();
    git(f.cwd, ['add', '.atm/history', '.atm/task-plans']);
    git(f.cwd, ['commit', '-q', '-m', 'hand-completed governed close commits']);
    const status = atm(f.cwd, ['taskflow', 'status', '--task', f.taskId]);
    assert.equal(status.json.evidence.closeRecovery.state, 'interrupted-landed', 'taskflow status surfaces the stuck close');
    assert.match(status.json.evidence.closeRecovery.recommendedCommand, /--recover/);
    const abort = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--abort', '--write']);
    assert.notEqual(abort.exitCode, 0);
    assert.ok(codes(abort).includes('ATM_CLOSE_RECOVERY_ALREADY_LANDED'), 'abort never undoes a landed close');
    const dry = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--recover']);
    assert.ok(codes(dry).includes('ATM_CLOSE_RECOVERY_DRY_RUN'), JSON.stringify(dry.json.messages));
    assert.ok(existsSync(path.join(f.cwd, '.atm/runtime/locks/close-window-staged-index.lock.json')), 'dry run changes nothing');
    const head = git(f.cwd, ['rev-parse', 'HEAD']).trim();
    const recover = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--recover', '--reason', 'fixture 0138', '--write']);
    assert.equal(recover.exitCode, 0, JSON.stringify(recover.json.messages));
    assert.ok(codes(recover).includes('ATM_CLOSE_RECOVERY_COMPLETED'));
    assert.equal(git(f.cwd, ['rev-parse', 'HEAD']).trim(), head, 'a landed close is never committed twice');
    assert.equal(existsSync(path.join(f.cwd, '.atm/runtime/locks/close-window-staged-index.lock.json')), false, 'lock released');
    assert.equal(existsSync(path.join(f.cwd, '.atm/runtime/close-transactions', `${f.taskId}.lock.json`)), false, 'dead mutex removed');
    const transaction = JSON.parse(readFileSync(path.join(f.cwd, '.atm/runtime/close-transactions', `${f.taskId}.json`), 'utf8'));
    assert.equal(transaction.phase, 'post-cleanup-complete');
    assert.equal(transaction.targetCommit, head);
    const receiptPath = path.join(f.cwd, '.atm/history/evidence', `${f.taskId}.close-recovery.json`);
    assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).entries.length, 1);
    const again = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--recover', '--write']);
    assert.ok(codes(again).includes('ATM_CLOSE_RECOVERY_NOTHING_TO_RECOVER'), 'repeat recovery is a no-op');
    assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).entries.length, 1, 'no-op appends nothing');
    const renew = atm(f.cwd, ['tasks', 'renew', '--task', f.taskId, '--actor', 'fixture-bot']);
    assert.notEqual(renew.exitCode, 0);
    assert.match(JSON.stringify(renew.json), /ATM_TASKS_RENEW_TASK_CLOSED/, 'renew never reopens a done task');
  }

  // Case 0140: died after the ledger write; bundle half staged; renew reopened the working ledger.
  {
    const f = fixture('interrupted-0140');
    f.writeClose();
    writeJson(path.join(f.cwd, '.atm/history/evidence', `${f.taskId}.seal-and-commit.json`), { schemaId: 'atm.taskflowSealAndCommitReceipt.v1', sealDigest: 'sha256:fixture', targetHeadBeforeCommit: git(f.cwd, ['rev-parse', 'HEAD']).trim() });
    writeJson(path.join(f.cwd, '.atm/history/evidence', `${f.taskId}.bundle-manifest.json`), { schemaId: 'fixture.bundle' });
    git(f.cwd, ['add', `.atm/history/tasks/${f.taskId}.json`, `.atm/history/task-events/${f.taskId}/${f.closeEvent}.json`, `.atm/history/evidence/${f.taskId}.closure-packet.json`, `.atm/history/evidence/${f.taskId}.bundle-manifest.json`]);
    // The pre-fix renew: working ledger back to running, close fields kept, a renew event.
    const renewEvent = eventId(5000, 'renew', 'r1');
    writeJson(path.join(f.cwd, '.atm/history/task-events', f.taskId, `${renewEvent}.json`), { transitionId: renewEvent, action: 'renew', fromStatus: 'done', toStatus: 'running', taskPath: `.atm/history/tasks/${f.taskId}.json`, createdAt: iso(5000) });
    writeJson(path.join(f.cwd, '.atm/history/tasks', `${f.taskId}.json`), { ...f.closedLedger, status: 'running', claim: { ...f.closedLedger.claim, state: 'active' }, lastTransitionId: renewEvent, lastTransitionAt: iso(5000) });
    const unrelated = path.join(f.cwd, 'notes.txt');
    writeFileSync(unrelated, 'foreign staged work\n', 'utf8');
    git(f.cwd, ['add', 'notes.txt']);

    const renew = atm(f.cwd, ['tasks', 'renew', '--task', f.taskId, '--actor', 'fixture-bot']);
    assert.notEqual(renew.exitCode, 0);
    assert.match(JSON.stringify(renew.json), /ATM_TASKS_RENEW_CLOSE_IN_PROGRESS/, 'renew refuses while the close window is held');

    f.setHolder(process.pid);
    const alive = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--abort', '--write']);
    assert.ok(codes(alive).includes('ATM_CLOSE_RECOVERY_HOLDER_ALIVE'), 'a live holder is never preempted');
    f.setHolder(deadPid);

    const recover = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--recover', '--write']);
    assert.ok(codes(recover).includes('ATM_CLOSE_RECOVERY_ROLL_FORWARD_INCONSISTENT'), JSON.stringify(recover.json.messages));
    assert.match(recover.json.evidence.requiredCommand ?? '', /--abort/);
    const stagedBefore = git(f.cwd, ['diff', '--cached', '--name-only']);
    const dry = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--abort']);
    assert.ok(codes(dry).includes('ATM_CLOSE_RECOVERY_DRY_RUN'));
    assert.equal(git(f.cwd, ['diff', '--cached', '--name-only']), stagedBefore, 'abort dry run leaves the index alone');

    const abort = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--abort', '--reason', 'fixture 0140', '--write']);
    assert.equal(abort.exitCode, 0, JSON.stringify(abort.json.messages));
    assert.ok(codes(abort).includes('ATM_CLOSE_RECOVERY_ABORTED'));
    assert.deepEqual(git(f.cwd, ['diff', '--cached', '--name-only']).trim().split('\n'), ['notes.txt'], 'only the foreign staged file stays staged');
    const events = readdirSync(path.join(f.cwd, '.atm/history/task-events', f.taskId)).sort();
    assert.deepEqual(events, [`${f.claimEvent}.json`, `${renewEvent}.json`], 'close transitions archived, earlier history kept');
    assert.equal(existsSync(path.join(f.cwd, '.atm/history/evidence', `${f.taskId}.closure-packet.json`)), false);
    assert.equal(existsSync(path.join(f.cwd, '.atm/history/evidence', `${f.taskId}.seal-and-commit.json`)), false);
    const ledger = JSON.parse(readFileSync(path.join(f.cwd, '.atm/history/tasks', `${f.taskId}.json`), 'utf8'));
    assert.equal(ledger.status, 'running');
    for (const key of ['closedAt', 'closedByActor', 'closurePacket']) assert.equal(key in ledger, false, `${key} removed`);
    assert.equal(ledger.claim.state, 'active');
    assert.equal('reason' in ledger.claim, false);
    assert.equal(ledger.lastTransitionId, renewEvent);
    assert.equal(sha(readFileSync(path.join(f.cwd, '.atm/task-plans', `${f.taskId}.md`), 'utf8')), sha(CARD), 'card restored to its sealed content');
    assert.equal(abort.json.evidence.result.card.matchesSeal, true);
    assert.equal(existsSync(path.join(f.cwd, '.atm/runtime/locks/close-window-staged-index.lock.json')), false, 'lock released');
    const transaction = JSON.parse(readFileSync(path.join(f.cwd, '.atm/runtime/close-transactions', `${f.taskId}.json`), 'utf8'));
    assert.equal(transaction.phase, 'rolled-back');
    const receipt = JSON.parse(readFileSync(path.join(f.cwd, '.atm/history/evidence', `${f.taskId}.close-recovery.json`), 'utf8'));
    assert.equal(receipt.entries.length, 1);
    assert.equal(receipt.entries[0].action, 'abort');
    for (const entry of receipt.entries[0].archived) {
      assert.ok(existsSync(path.join(f.cwd, entry.archivePath)), `archived ${entry.path}`);
      assert.equal(sha(readFileSync(path.join(f.cwd, entry.archivePath), 'utf8')), entry.sha256);
    }
    const again = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--abort', '--write']);
    assert.ok(codes(again).includes('ATM_CLOSE_RECOVERY_NOTHING_TO_RECOVER'), 'repeat abort is a no-op');
  }

  // Consistent but not landed: the staged close is whole, so recover rolls it forward.
  {
    const f = fixture('consistent');
    f.writeClose();
    git(f.cwd, ['add', '.atm/history', '.atm/task-plans']);
    const dry = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--recover']);
    assert.ok(codes(dry).includes('ATM_CLOSE_RECOVERY_DRY_RUN'), JSON.stringify(dry.json.messages));
    assert.equal(dry.json.evidence.inspection.rollForward.possible, true);
    assert.match(dry.json.messages[0].text, /commit the staged close bundle/);
  }

  // Nothing stuck: no transaction, no lock.
  {
    const f = fixture('clean');
    rmSync(path.join(f.cwd, '.atm/runtime'), { recursive: true, force: true });
    const recover = atm(f.cwd, ['taskflow', 'close', '--task', f.taskId, '--actor', 'fixture-bot', '--recover', '--write']);
    assert.ok(codes(recover).includes('ATM_CLOSE_RECOVERY_NOTHING_TO_RECOVER'));
  }

  // Directories (nested repos, gitignored run dirs) never reach the payload digest reader.
  const dirPath = path.join(tempRoot, 'kit/state/runs/arm-a/work');
  mkdirSync(dirPath, { recursive: true });
  assert.equal(isRegularPayloadFile(dirPath), false);
  writeFileSync(path.join(dirPath, 'file.txt'), 'x');
  assert.equal(isRegularPayloadFile(path.join(dirPath, 'file.txt')), true);

  console.log('taskflow close recovery: ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
