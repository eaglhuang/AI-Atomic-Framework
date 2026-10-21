import { closeSync, existsSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from 'node:fs';
import path from 'node:path';
import { defaultStewardCommitLockRoot } from '../broker/steward-commit-guard.js';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock } from '../broker/steward-kernel-lock.js';
import { parseLiveWriteJournal } from './live-write-journal.js';
export class RecoveryRequiredError extends Error {
}
export function isCommitted(entry) {
    return entry.kind === undefined || entry.kind === 'committed';
}
export function journalPath(cwd) {
    return path.join(cwd, '.atm/runtime/live-write-journal.jsonl');
}
export function readJournal(cwd) {
    try {
        return existsSync(journalPath(cwd)) ? parseLiveWriteJournal(readFileSync(journalPath(cwd), 'utf8')) : [];
    }
    catch (error) {
        throw new RecoveryRequiredError(String(error));
    }
}
export function appendJournal(cwd, entry) {
    // Different file writers share this log. Serialize tail repair and the single
    // O_APPEND write, independently of the file/commit locks.
    const lock = path.join(defaultStewardCommitLockRoot(cwd), 'live-write-journal');
    acquireKernelAdvisoryLock(lock, 30_000, 5, 'live-write journal');
    try {
        const target = journalPath(cwd);
        mkdirSync(path.dirname(target), { recursive: true });
        if (existsSync(target)) {
            const text = readFileSync(target, 'utf8');
            readJournal(cwd); // Reject middle corruption before any mutation.
            const lines = text.split('\n');
            let last = lines.length - 1;
            while (last >= 0 && !lines[last].trim())
                last -= 1;
            if (last >= 0) {
                let invalid = last === lines.length - 1;
                try {
                    JSON.parse(lines[last]);
                }
                catch {
                    invalid = true;
                }
                if (invalid)
                    truncateSync(target, Buffer.byteLength(lines.slice(0, last).join('\n') + (last > 0 ? '\n' : '')));
            }
        }
        const fd = openSync(target, 'a');
        try {
            writeSync(fd, `${JSON.stringify(entry)}\n`);
        }
        finally {
            closeSync(fd);
        }
    }
    finally {
        releaseKernelAdvisoryLock(lock);
    }
}
