import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAttemptPaths, readCloseAttempt, writeCloseAtomic, writeCloseAttempt, type CloseAttempt } from '../close-attempt.ts';
import { queryCloseAttempt, runCloseAttemptWorker, startDetachedClose } from '../close-detach.ts';
import { readCloseTransactionStatus } from '../close-transaction-status.ts';
import { writeResult } from '../../shared.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-close-detach-'));
const children: number[] = [];
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'fixture timed out');
    await delay(20);
  }
}
function attempt(taskId: string, attemptId: string): CloseAttempt {
  return { schemaId: 'atm.closeAttempt.v1', taskId, attemptId, actorId: 'fixture', state: 'starting',
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ownerPid: null, targetCommit: null, failure: null };
}
const helper = new URL('../close-detach.ts', import.meta.url).href;
const statusHelper = new URL('../close-transaction-status.ts', import.meta.url).href;
const runner = path.join(cwd, 'worker.mjs');
writeFileSync(runner, `
import { runCloseAttemptWorker } from ${JSON.stringify(helper)};
import { writeCloseTransactionStatus } from ${JSON.stringify(statusHelper)};
const cwd = process.cwd(), taskId = process.env.ATM_CLOSE_ATTEMPT_TASK;
await runCloseAttemptWorker({ cwd, taskId, attemptId: process.env.ATM_CLOSE_ATTEMPT_ID, action: async () => {
  writeCloseTransactionStatus({ cwd, taskId, phase: 'started' });
  await new Promise(r => setTimeout(r, taskId === 'SLOW' ? 10000 : 600));
  writeCloseTransactionStatus({ cwd, taskId, phase: 'post-cleanup-complete', cleanupComplete: true, targetCommit: 'a'.repeat(40) });
  return { ok: true };
}});
`);

try {
  assert.throws(() => closeAttemptPaths(cwd, '../outside', 'attempt'), /Invalid/);
  assert.throws(() => closeAttemptPaths(cwd, 'TASK', '../outside'), /Invalid/);
  const first = attempt('LOCAL', 'one');
  writeCloseAttempt(cwd, first);
  assert.deepEqual(readCloseAttempt(cwd, 'LOCAL', 'one'), first);
  writeCloseAtomic(closeAttemptPaths(cwd, 'LOCAL', 'one').record, '{broken');
  assert.equal(readCloseAttempt(cwd, 'LOCAL', 'one'), null, 'corruption is never success');
  writeCloseAttempt(cwd, first);
  const missing = await queryCloseAttempt({ cwd, taskId: 'LOCAL', attemptId: 'missing' });
  assert.equal(missing.ok, false);
  assert.match(missing.closeResultLine, /CLOSE_ATTEMPT_MISSING/);
  const running = await queryCloseAttempt({ cwd, taskId: 'LOCAL', attemptId: 'one', wait: true, timeoutMs: 0 });
  assert.match(running.closeResultLine, /CLOSE_WAIT_TIMEOUT/);
  assert.match(running.closeResultLine, /started is not committed/);
  await assert.rejects(queryCloseAttempt({ cwd, taskId: 'LOCAL', attemptId: 'one', timeoutMs: NaN }), /finite/);

  // A successful action without a committed transaction must never say committed.
  await runCloseAttemptWorker({ cwd, taskId: 'LOCAL', attemptId: 'one', action: async () => ({ ok: true }) });
  assert.equal(readCloseAttempt(cwd, 'LOCAL', 'one')?.state, 'failed');
  assert.match(readFileSync(closeAttemptPaths(cwd, 'LOCAL', 'one').result, 'utf8'), /CLOSE_FAILED/);
  await assert.rejects(runCloseAttemptWorker({ cwd, taskId: 'LOCAL', attemptId: 'one', action: async () => ({ ok: true }) }), /already started/);

  const started = await startDetachedClose({ cwd, taskId: 'SUCCESS', actorId: 'fixture', argv: ['close', '--write', '--detach'], runner });
  const id = String(started.evidence.attemptId);
  const child = readCloseAttempt(cwd, 'SUCCESS', id)!;
  children.push(child.ownerPid!);
  assert.ok(child.ownerPid, 'CLOSE_STARTED requires a durable child acknowledgement');
  assert.match(started.closeResultLine, /CLOSE_STARTED/);
  assert.equal(started.closeResultLine.trim().split('\n').length, 1);
  let stdout = '';
  writeResult(started, { write: (text) => { stdout += text; } });
  assert.equal(stdout, started.closeResultLine, 'CLI output stays exactly one result line');
  const completed = await queryCloseAttempt({ cwd, taskId: 'SUCCESS', attemptId: id, wait: true, timeoutMs: 10_000 });
  assert.match(completed.closeResultLine, /CLOSE_COMMITTED/);
  assert.equal(readCloseTransactionStatus(cwd, 'SUCCESS')?.attemptId, id);

  // A different attempt cannot borrow this task's successful transaction.
  writeCloseAttempt(cwd, { ...attempt('SUCCESS', 'different'), state: 'failed', failure: 'fixture' });
  assert.match((await queryCloseAttempt({ cwd, taskId: 'SUCCESS', attemptId: 'different' })).closeResultLine, /CLOSE_INTERRUPTED/);

  const slow = await startDetachedClose({ cwd, taskId: 'SLOW', actorId: 'fixture', argv: ['close', '--write'], runner });
  const slowId = String(slow.evidence.attemptId), slowPid = readCloseAttempt(cwd, 'SLOW', slowId)!.ownerPid!;
  children.push(slowPid);
  process.kill(slowPid, 'SIGKILL');
  await delay(100);
  assert.match((await queryCloseAttempt({ cwd, taskId: 'SLOW', attemptId: slowId })).closeResultLine, /CLOSE_INTERRUPTED/);

  if (process.platform !== 'win32') {
    // Exercise actual setsid/session separation in this executor: killing the
    // caller's process group cannot kill the acknowledged detached worker.
    const launcher = path.join(cwd, 'launcher.mjs'), receipt = path.join(cwd, 'caller.json');
    writeFileSync(launcher, `import { writeFileSync } from 'node:fs';
import { startDetachedClose } from ${JSON.stringify(helper)};
const result = await startDetachedClose({ cwd: process.cwd(), taskId: 'CALLER', actorId: 'fixture', argv: ['close','--write'], runner: ${JSON.stringify(runner)} });
writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(result.evidence));
setInterval(() => {}, 1000);`);
    const caller: ChildProcess = spawn(process.execPath, ['--strip-types', launcher], { cwd, detached: true, stdio: 'ignore' });
    try {
      await waitFor(() => existsSync(receipt));
      const callerId = JSON.parse(readFileSync(receipt, 'utf8')).attemptId;
      children.push(readCloseAttempt(cwd, 'CALLER', callerId)!.ownerPid!);
      process.kill(-caller.pid!, 'SIGKILL');
      assert.match((await queryCloseAttempt({ cwd, taskId: 'CALLER', attemptId: callerId, wait: true, timeoutMs: 10_000 })).closeResultLine, /CLOSE_COMMITTED/);
    } finally { try { caller.kill('SIGKILL'); } catch { /* already exited */ } }
  }
  console.log('close-detach: persistence, handshake, attempt isolation, wait, worker kill and caller-group kill passed');
} finally {
  for (const pid of children) { try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ } }
  rmSync(cwd, { recursive: true, force: true });
}
