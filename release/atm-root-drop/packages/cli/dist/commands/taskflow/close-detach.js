import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeResult, message } from '../shared.js';
import { readCloseWindowStagedIndexLockReport } from '../tasks/close-window-lock.js';
import { isProcessAlive } from '../tasks/close-holder-liveness.js';
import { closeAttemptPaths, closeResultLine, readCloseAttempt, writeCloseAtomic, writeCloseAttempt } from './close-attempt.js';
import { readCloseTransactionStatus } from './close-transaction-status.js';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function result(cwd, record, taskId, attemptId, code, status, hint) {
    const log = closeAttemptPaths(cwd, taskId, attemptId).log;
    return { ...makeResult({ ok: status !== 'fail', command: 'taskflow close', cwd, mode: 'attempt',
            messages: [message(status === 'fail' ? 'error' : 'info', code, hint)], evidence: { taskId, attemptId, attempt: record } }),
        closeResultLine: closeResultLine({ code, status, log, hint: `attempt=${attemptId} ${hint}` }) };
}
function detachedRunner() {
    const caller = process.argv[1];
    if (caller && /^atm(?:-public|\.dev)?\.(?:mjs|js|ts)$/.test(path.basename(caller)))
        return path.resolve(caller);
    const own = fileURLToPath(import.meta.url);
    if (/^atm.*\.mjs$/.test(path.basename(own)))
        return own;
    return path.resolve(path.dirname(own), '../..', own.endsWith('.ts') ? 'atm.ts' : 'atm.js');
}
function workerExecArgs() {
    const result = [];
    for (let i = 0; i < process.execArgv.length; i++) {
        const arg = process.execArgv[i];
        if (['-e', '--eval', '-p', '--print', '--input-type'].includes(arg)) {
            i++;
            continue;
        }
        if (/^--(?:inspect|test|input-type|eval|print)(?:[=-]|$)/.test(arg))
            continue;
        result.push(arg);
    }
    return result;
}
/** The worker must acknowledge a durable attempt before the caller reports started. */
export async function startDetachedClose(input) {
    if (!input.taskId || !input.actorId)
        throw new Error('--detach requires --task and --actor');
    const attemptId = randomUUID();
    const paths = closeAttemptPaths(input.cwd, input.taskId, attemptId);
    const now = new Date().toISOString();
    const record = { schemaId: 'atm.closeAttempt.v1', taskId: input.taskId, actorId: input.actorId, attemptId,
        state: 'starting', startedAt: now, updatedAt: now, ownerPid: null, targetCommit: null, failure: null };
    writeCloseAttempt(input.cwd, record);
    mkdirSync(path.dirname(paths.log), { recursive: true });
    const fd = openSync(paths.log, 'a', 0o600);
    let child;
    try {
        const argv = [];
        for (let i = 0; i < input.argv.length; i++) {
            const arg = input.argv[i];
            if (['--detach', '--json', '--pretty'].includes(arg) || arg.startsWith('--cwd='))
                continue;
            if (arg === '--cwd') {
                i++;
                continue;
            }
            argv.push(arg);
            if (arg === '--profile' && input.argv[i + 1])
                argv.push(path.resolve(input.argv[++i]));
        }
        argv.push('--cwd', input.cwd);
        child = spawn(process.execPath, [...workerExecArgs(), input.runner ?? detachedRunner(), 'taskflow', ...argv, '--json'], {
            cwd: input.cwd, detached: true, stdio: ['ignore', fd, fd],
            env: { ...process.env, ATM_CLOSE_ATTEMPT_ID: attemptId, ATM_CLOSE_ATTEMPT_TASK: input.taskId }
        });
    }
    finally {
        closeSync(fd);
    }
    let failed = null;
    child.on('error', (error) => { failed = error.message; });
    child.unref();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const current = readCloseAttempt(input.cwd, input.taskId, attemptId);
        if (current?.ownerPid === child.pid) {
            return result(input.cwd, current, input.taskId, attemptId, 'CLOSE_STARTED', 'ok', 'started; query --status/--wait with this attempt ID');
        }
        if (failed || child.exitCode !== null || child.signalCode !== null)
            break;
        await delay(25);
    }
    const current = readCloseAttempt(input.cwd, input.taskId, attemptId);
    if (current?.state === 'starting' && (failed || child.exitCode !== null || child.signalCode !== null)) {
        writeCloseAttempt(input.cwd, { ...current, state: 'failed', failure: failed ?? 'child exited before acknowledgement', updatedAt: new Date().toISOString() });
    }
    // Never overwrite a late worker acknowledgement. Unknown startup is recoverable,
    // but is never acknowledged as CLOSE_STARTED.
    return result(input.cwd, readCloseAttempt(input.cwd, input.taskId, attemptId), input.taskId, attemptId, 'CLOSE_START_UNCONFIRMED', 'fail', failed ?? 'child start unconfirmed; inspect this attempt before retrying');
}
export async function queryCloseAttempt(input) {
    if (!input.taskId || !input.attemptId)
        throw new Error('--status/--wait requires --task and --attempt');
    const timeout = input.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeout) || timeout < 0)
        throw new Error('--timeout-ms must be finite and nonnegative');
    const deadline = Date.now() + timeout;
    while (true) {
        const record = readCloseAttempt(input.cwd, input.taskId, input.attemptId);
        if (!record)
            return result(input.cwd, null, input.taskId, input.attemptId, 'CLOSE_ATTEMPT_MISSING', 'fail', 'attempt does not exist');
        const transaction = readCloseTransactionStatus(input.cwd, input.taskId);
        // Recovery can complete a dead child's attempt without rerunning the worker.
        const alive = record.ownerPid !== null && isProcessAlive(record.ownerPid);
        const window = readCloseWindowStagedIndexLockReport(input.cwd);
        const cleanupPending = window?.status === 'active' && window.taskId === input.taskId;
        const completed = (record.state === 'completed' && record.targetCommit !== null) || (!alive && !cleanupPending && transaction?.attemptId === input.attemptId && transaction.outcome === 'completed' && transaction.cleanupComplete && transaction.targetCommit !== null);
        if (completed)
            return result(input.cwd, record, input.taskId, input.attemptId, 'CLOSE_COMMITTED', 'ok', `committed=${record.targetCommit ?? transaction?.targetCommit}${record.closeTiming ? ` locked_ms=${record.closeTiming.lockedMs} total_ms=${record.closeTiming.totalMs}` : ''}`);
        const recover = `node atm.mjs taskflow close --task ${input.taskId} --actor ${record.actorId} --recover (or --abort); inspect dry-run first`;
        if (record.state === 'failed' || (!alive && record.state !== 'starting'))
            return result(input.cwd, record, input.taskId, input.attemptId, 'CLOSE_INTERRUPTED', 'fail', recover);
        if (!input.wait || Date.now() >= deadline)
            return result(input.cwd, record, input.taskId, input.attemptId, input.wait ? 'CLOSE_WAIT_TIMEOUT' : 'CLOSE_RUNNING', 'running', `started is not committed; ${recover}`);
        await delay(Math.min(100, Math.max(1, deadline - Date.now())));
    }
}
export async function runCloseAttemptWorker(input) {
    const record = readCloseAttempt(input.cwd, input.taskId, input.attemptId);
    if (!record || record.state !== 'starting' || record.ownerPid !== null)
        throw new Error('Close attempt is missing or already started');
    // An immutable, exclusive owner marker also fences simultaneous launches of
    // the same attempt between reading the queued record and acknowledging it.
    const owner = openSync(closeAttemptPaths(input.cwd, input.taskId, input.attemptId).owner, 'wx', 0o600);
    try {
        writeFileSync(owner, String(process.pid));
        fsyncSync(owner);
    }
    finally {
        closeSync(owner);
    }
    const running = { ...record, state: 'running', ownerPid: process.pid, updatedAt: new Date().toISOString() };
    writeCloseAttempt(input.cwd, running);
    let value;
    try {
        value = await input.action();
    }
    catch (error) {
        finish(false, error instanceof Error ? error.message : String(error));
        throw error;
    }
    const timing = value.evidence?.closeTiming;
    finish(value.ok === true, value.ok ? null : 'close returned failure', timing);
    return value;
    function finish(ok, failure, closeTiming) {
        const transaction = readCloseTransactionStatus(input.cwd, input.taskId);
        const committed = ok && transaction?.attemptId === input.attemptId && transaction.outcome === 'completed' && transaction.cleanupComplete && transaction.targetCommit !== null;
        const final = { ...running, closeTiming, state: committed ? 'completed' : 'failed', updatedAt: new Date().toISOString(),
            targetCommit: transaction?.attemptId === input.attemptId ? transaction.targetCommit : null, failure: failure ?? (committed ? null : 'close did not commit') };
        writeCloseAttempt(input.cwd, final);
        writeCloseAtomic(closeAttemptPaths(input.cwd, input.taskId, input.attemptId).result, closeResultLine({ status: committed ? 'ok' : 'fail', code: committed ? 'CLOSE_COMMITTED' : 'CLOSE_FAILED', log: closeAttemptPaths(input.cwd, input.taskId, input.attemptId).log,
            hint: `attempt=${input.attemptId} ${final.failure ?? `committed=${final.targetCommit}`}` }));
    }
}
