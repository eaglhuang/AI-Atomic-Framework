import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export function closeAttemptPaths(cwd, taskId, attemptId) {
    for (const id of [taskId, attemptId]) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id))
            throw new Error('Invalid close task/attempt ID');
    }
    const base = path.join(cwd, '.atm/runtime/close', taskId, attemptId);
    return { record: `${base}.json`, owner: `${base}.owner`, log: `${base}.log`, result: `${base}.result` };
}
/** Publish only complete durable records, including after a host power loss. */
export function writeCloseAtomic(file, content) {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try {
        writeFileSync(fd, content, 'utf8');
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(temporary, file);
    // Linux directory fsync makes the rename durable, not merely atomic.
    if (process.platform !== 'win32') {
        const directory = openSync(path.dirname(file), 'r');
        try {
            fsyncSync(directory);
        }
        finally {
            closeSync(directory);
        }
    }
}
export function readCloseAttempt(cwd, taskId, attemptId) {
    const file = closeAttemptPaths(cwd, taskId, attemptId).record;
    try {
        const value = JSON.parse(readFileSync(file, 'utf8'));
        return value.schemaId === 'atm.closeAttempt.v1' && value.taskId === taskId && value.attemptId === attemptId ? value : null;
    }
    catch {
        return null;
    }
}
export function writeCloseAttempt(cwd, record) {
    writeCloseAtomic(closeAttemptPaths(cwd, record.taskId, record.attemptId).record, `${JSON.stringify(record, null, 2)}\n`);
}
export function closeResultLine(input) {
    return `ATM-RESULT step=close status=${input.status} code=${input.code} log=${JSON.stringify(input.log)} hint=${JSON.stringify(input.hint)}\n`;
}
