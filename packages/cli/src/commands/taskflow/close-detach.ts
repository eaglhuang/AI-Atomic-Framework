import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeResult, message } from '../shared.ts';
import { isProcessAlive } from '../tasks/close-holder-liveness.ts';
import { closeAttemptPaths, closeResultLine, readCloseAttempt, writeCloseAtomic, writeCloseAttempt, type CloseAttempt } from './close-attempt.ts';
import { readCloseTransactionStatus } from './close-transaction-status.ts';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function result(cwd: string, record: CloseAttempt | null, taskId: string, attemptId: string, code: string, status: 'ok' | 'fail' | 'running', hint: string) {
  const log = closeAttemptPaths(cwd, taskId, attemptId).log;
  return { ...makeResult({ ok: status !== 'fail', command: 'taskflow close', cwd, mode: 'attempt',
    messages: [message(status === 'fail' ? 'error' : 'info', code, hint)], evidence: { taskId, attemptId, attempt: record } }),
  closeResultLine: closeResultLine({ code, status, log, hint: `attempt=${attemptId} ${hint}` }) };
}

/** The worker must acknowledge a durable attempt before the caller reports started. */
export async function startDetachedClose(input: { cwd: string; taskId: string; actorId: string; argv: string[]; runner?: string }) {
  if (!input.taskId || !input.actorId) throw new Error('--detach requires --task and --actor');
  const attemptId = randomUUID();
  const paths = closeAttemptPaths(input.cwd, input.taskId, attemptId);
  const now = new Date().toISOString();
  const record: CloseAttempt = { schemaId: 'atm.closeAttempt.v1', taskId: input.taskId, actorId: input.actorId, attemptId,
    state: 'starting', startedAt: now, updatedAt: now, ownerPid: null, targetCommit: null, failure: null };
  writeCloseAttempt(input.cwd, record);
  mkdirSync(path.dirname(paths.log), { recursive: true });
  const fd = openSync(paths.log, 'a', 0o600);
  let child: ReturnType<typeof spawn>;
  try {
    const argv = input.argv.filter((arg) => !['--detach', '--json', '--pretty'].includes(arg));
    child = spawn(process.execPath, [...process.execArgv.filter((arg) => !arg.startsWith('--inspect')), input.runner ?? process.argv[1], 'taskflow', ...argv, '--json'], {
      cwd: input.cwd, detached: true, stdio: ['ignore', fd, fd],
      env: { ...process.env, ATM_CLOSE_ATTEMPT_ID: attemptId, ATM_CLOSE_ATTEMPT_TASK: input.taskId }
    });
  } finally { closeSync(fd); }
  let failed: string | null = null;
  child.on('error', (error) => { failed = error.message; });
  child.unref();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = readCloseAttempt(input.cwd, input.taskId, attemptId);
    if (current?.ownerPid === child.pid) {
      return result(input.cwd, current, input.taskId, attemptId, 'CLOSE_STARTED', 'ok', 'started; query --status/--wait with this attempt ID');
    }
    if (failed || child.exitCode !== null || child.signalCode !== null) break;
    await delay(25);
  }
  const current = readCloseAttempt(input.cwd, input.taskId, attemptId);
  if (current?.state === 'starting' && (failed || child.exitCode !== null || child.signalCode !== null)) {
    writeCloseAttempt(input.cwd, { ...current, state: 'failed', failure: failed ?? 'child exited before acknowledgement', updatedAt: new Date().toISOString() });
  }
  // Never overwrite a late worker acknowledgement. Unknown startup is recoverable,
  // but is never acknowledged as CLOSE_STARTED.
  return result(input.cwd, readCloseAttempt(input.cwd, input.taskId, attemptId), input.taskId, attemptId,
    'CLOSE_START_UNCONFIRMED', 'fail', failed ?? 'child start unconfirmed; inspect this attempt before retrying');
}

export async function queryCloseAttempt(input: { cwd: string; taskId: string; attemptId: string; wait?: boolean; timeoutMs?: number }) {
  if (!input.taskId || !input.attemptId) throw new Error('--status/--wait requires --task and --attempt');
  const timeout = input.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeout) || timeout < 0) throw new Error('--timeout-ms must be finite and nonnegative');
  const deadline = Date.now() + timeout;
  while (true) {
    const record = readCloseAttempt(input.cwd, input.taskId, input.attemptId);
    if (!record) return result(input.cwd, null, input.taskId, input.attemptId, 'CLOSE_ATTEMPT_MISSING', 'fail', 'attempt does not exist');
    const transaction = readCloseTransactionStatus(input.cwd, input.taskId);
    // Recovery can complete a dead child's attempt without rerunning the worker.
    const completed = (record.state === 'completed' && record.targetCommit !== null) || (transaction?.attemptId === input.attemptId && transaction.outcome === 'completed' && transaction.cleanupComplete && transaction.targetCommit !== null);
    if (completed) return result(input.cwd, record, input.taskId, input.attemptId, 'CLOSE_COMMITTED', 'ok', `committed=${record.targetCommit ?? transaction?.targetCommit}`);
    const alive = record.ownerPid !== null && isProcessAlive(record.ownerPid);
    const recover = `node atm.mjs taskflow close --task ${input.taskId} --actor ${record.actorId} --recover (or --abort); inspect dry-run first`;
    if (record.state === 'failed' || (!alive && record.state !== 'starting')) return result(input.cwd, record, input.taskId, input.attemptId, 'CLOSE_INTERRUPTED', 'fail', recover);
    if (!input.wait || Date.now() >= deadline) return result(input.cwd, record, input.taskId, input.attemptId,
      input.wait ? 'CLOSE_WAIT_TIMEOUT' : 'CLOSE_RUNNING', 'running', `started is not committed; ${recover}`);
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
}

export async function runCloseAttemptWorker<T extends { ok?: boolean }>(input: { cwd: string; taskId: string; attemptId: string; action: () => Promise<T> }): Promise<T> {
  const record = readCloseAttempt(input.cwd, input.taskId, input.attemptId);
  if (!record || record.state !== 'starting' || record.ownerPid !== null) throw new Error('Close attempt is missing or already started');
  // An immutable, exclusive owner marker also fences simultaneous launches of
  // the same attempt between reading the queued record and acknowledging it.
  const owner = openSync(closeAttemptPaths(input.cwd, input.taskId, input.attemptId).owner, 'wx', 0o600);
  try { writeFileSync(owner, String(process.pid)); fsyncSync(owner); } finally { closeSync(owner); }
  const running: CloseAttempt = { ...record, state: 'running', ownerPid: process.pid, updatedAt: new Date().toISOString() };
  writeCloseAttempt(input.cwd, running);
  let value: T;
  try { value = await input.action(); }
  catch (error) { finish(false, error instanceof Error ? error.message : String(error)); throw error; }
  finish(value.ok === true, value.ok ? null : 'close returned failure');
  return value;

  function finish(ok: boolean, failure: string | null) {
    const transaction = readCloseTransactionStatus(input.cwd, input.taskId);
    const committed = ok && transaction?.attemptId === input.attemptId && transaction.outcome === 'completed' && transaction.cleanupComplete && transaction.targetCommit !== null;
    const final: CloseAttempt = { ...running, state: committed ? 'completed' : 'failed', updatedAt: new Date().toISOString(),
      targetCommit: transaction?.attemptId === input.attemptId ? transaction.targetCommit : null, failure: failure ?? (committed ? null : 'close did not commit') };
    writeCloseAttempt(input.cwd, final);
    writeCloseAtomic(closeAttemptPaths(input.cwd, input.taskId, input.attemptId).result,
      closeResultLine({ status: committed ? 'ok' : 'fail', code: committed ? 'CLOSE_COMMITTED' : 'CLOSE_FAILED', log: closeAttemptPaths(input.cwd, input.taskId, input.attemptId).log,
        hint: `attempt=${input.attemptId} ${final.failure ?? `committed=${final.targetCommit}`}` }));
  }
}
