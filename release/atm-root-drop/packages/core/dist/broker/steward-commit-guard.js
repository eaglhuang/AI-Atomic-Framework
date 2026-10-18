/**
 * 跨行程的 canonical commit 守衛。
 * 合成與驗證留在鎖外；鎖只包住 base hash 比對與同目錄原子改名。
 * base 不符就回 re-compose，不寫入。暫存檔寫到一半不會改到正式檔。
 * 鎖是核心層建議鎖，不看 pid。持有者留在其他 PID namespace 時也不會被當成已死。
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { closeSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { hashContent } from './adapters/cas.js';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock, StewardLockTimeoutError } from './steward-kernel-lock.js';
/**
 * Cross-process canonical commit policy.
 * Compose and validation stay outside this boundary. The lock covers only the
 * base-hash compare and the atomic rename.
 */
export const stewardCanonicalCommitPolicy = {
    schemaId: 'atm.stewardCanonicalCommitPolicy.v1',
    lockWaitMs: 2_000,
    lockPollMs: 5,
    /** Extra compose attempts after the first. Each attempt ends applied, blocked, rolled-back, re-compose, or recovery-required. */
    maxRecomposeAttempts: 4,
    recomposeBackoffMs: 4,
    recomposeJitterMs: 3,
    /** Per-target apply queue in front of the file lock. `off` leaves the file lock as the only serializer. */
    applyQueue: 'on',
    applyQueueWaitMs: 10_000
};
/** attempt 從 1 起算。backoff 隨次數增加，jitter 含 0。 */
export function stewardRecomposeDelayMs(attempt, backoffMs, jitterMs) {
    if (attempt <= 0 || backoffMs < 0 || jitterMs < 0)
        return 0;
    const jitter = jitterMs === 0 ? 0 : randomInt(0, jitterMs + 1);
    return backoffMs * attempt + jitter;
}
export function waitStewardRecomposeBackoff(attempt, backoffMs, jitterMs) {
    const delay = stewardRecomposeDelayMs(attempt, backoffMs, jitterMs);
    if (delay > 0)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
}
/**
 * 鎖放在儲存庫的 ATM 狀態目錄，讓不同 TMPDIR 或容器共用同一份工作樹。
 * 未給 cwd 時用 process.cwd()。
 */
export function defaultStewardCommitLockRoot(cwd = process.cwd()) {
    return path.join(path.resolve(cwd), '.atm', 'runtime', 'steward-commit-locks');
}
export function stewardCommitTargetKey(targetPath) {
    return createHash('sha256').update(realpathSync(targetPath)).digest('hex');
}
export function canonicalCommitLockPath(lockRoot, targetPath) {
    return path.join(lockRoot, stewardCommitTargetKey(targetPath));
}
/**
 * Commit composed bytes only when every target still matches its compose base.
 * A mismatch returns `re-compose` and does not write. A temp-file failure
 * leaves the canonical file untouched.
 */
export function commitCanonicalFiles(input) {
    const lockRoot = input.lockRoot ?? defaultStewardCommitLockRoot(input.cwd);
    const lockWaitMs = input.lockWaitMs ?? stewardCanonicalCommitPolicy.lockWaitMs;
    const lockPollMs = input.lockPollMs ?? stewardCanonicalCommitPolicy.lockPollMs;
    const entries = [...input.entries].sort((left, right) => left.filePath.localeCompare(right.filePath));
    const held = [];
    const backups = new Map();
    const files = [];
    let failedFile = null;
    try {
        for (const entry of entries) {
            const lockDir = canonicalCommitLockPath(lockRoot, entry.targetPath);
            acquireKernelAdvisoryLock(lockDir, lockWaitMs, lockPollMs, entry.filePath);
            held.push(lockDir);
        }
        for (const entry of entries)
            removeOrphanCanonicalTemps(entry.targetPath);
        for (const entry of entries) {
            const before = readFileSync(entry.targetPath, 'utf8');
            const observed = hashContent(before);
            if (observed !== entry.expectedBaseHash) {
                return {
                    status: 're-compose',
                    reason: `re-compose: canonical target base hash changed before commit: ${entry.filePath} (expected ${entry.expectedBaseHash}, observed ${observed}). Re-read the file and compose again against the current bytes.`,
                    failedFile: entry.filePath,
                    restoredFiles: [],
                    files: []
                };
            }
            backups.set(entry.filePath, before);
        }
        input.whileLocked?.();
        let writeCount = 0;
        for (const entry of entries) {
            failedFile = entry.filePath;
            if (input.failAfterWrites !== undefined && writeCount >= input.failAfterWrites) {
                throw new Error(`injected apply failure before ${entry.filePath}`);
            }
            if (input.commitFault && writeCount === 0) {
                throwCommitFault(entry, input.commitFault);
            }
            replaceFileAtomically(entry.targetPath, entry.content);
            const after = readFileSync(entry.targetPath, 'utf8');
            const afterHash = hashContent(after);
            if (afterHash !== entry.outputHash) {
                throw new Error(`canonical output hash mismatch after replace: ${entry.filePath}`);
            }
            files.push({
                filePath: entry.filePath,
                beforeHash: entry.expectedBaseHash,
                afterHash,
                outputHash: entry.outputHash
            });
            writeCount += 1;
        }
        return {
            status: 'applied',
            reason: '',
            failedFile: null,
            restoredFiles: [],
            files
        };
    }
    catch (error) {
        if (error instanceof StewardLockTimeoutError && files.length === 0) {
            return {
                status: 'recovery-required',
                reason: error.message,
                failedFile: error.filePath,
                restoredFiles: [],
                files: []
            };
        }
        const restoredFiles = [];
        for (const [filePath, content] of [...backups].reverse()) {
            const entry = entries.find((candidate) => candidate.filePath === filePath);
            if (!entry)
                continue;
            try {
                replaceFileAtomically(entry.targetPath, content);
                restoredFiles.push(filePath);
            }
            catch (restoreError) {
                return {
                    status: 'recovery-required',
                    reason: `recovery-required: canonical rollback failed for ${filePath}: ${errorText(restoreError)}. Previous error: ${errorText(error)}.`,
                    failedFile: filePath,
                    restoredFiles: [...restoredFiles].sort((left, right) => left.localeCompare(right)),
                    files
                };
            }
        }
        return {
            status: 'rolled-back',
            reason: errorText(error),
            failedFile,
            restoredFiles: restoredFiles.sort((left, right) => left.localeCompare(right)),
            files
        };
    }
    finally {
        for (const lockDir of [...held].reverse())
            releaseKernelAdvisoryLock(lockDir);
    }
}
/** 測試用。握住核心層建議鎖直到呼叫端放開。pid 檔不會讓這把鎖被別人搶走。 */
export function holdCanonicalCommitLock(lockDir, filePath = 'canonical-target') {
    acquireKernelAdvisoryLock(lockDir, stewardCanonicalCommitPolicy.lockWaitMs, stewardCanonicalCommitPolicy.lockPollMs, filePath);
    return () => releaseKernelAdvisoryLock(lockDir);
}
/**
 * 只在自己拿到排他鎖時刪暫存檔。拿不到鎖代表寫入者還活著（含其他 PID namespace），一個都不刪。
 */
export function cleanupOrphanCanonicalTemps(input) {
    const lockRoot = input.lockRoot ?? defaultStewardCommitLockRoot(input.cwd);
    const lockDir = canonicalCommitLockPath(lockRoot, input.targetPath);
    try {
        acquireKernelAdvisoryLock(lockDir, 0, 1, input.targetPath);
    }
    catch (error) {
        if (error instanceof StewardLockTimeoutError)
            return { removed: [], skippedLiveHolder: true };
        throw error;
    }
    try {
        return { removed: removeOrphanCanonicalTemps(input.targetPath), skippedLiveHolder: false };
    }
    finally {
        releaseKernelAdvisoryLock(lockDir);
    }
}
function removeOrphanCanonicalTemps(targetPath) {
    const directory = path.dirname(targetPath);
    const prefix = `.${path.basename(targetPath)}.`;
    let names = [];
    try {
        names = readdirSync(directory);
    }
    catch {
        return [];
    }
    const removed = [];
    for (const name of names) {
        if (!name.startsWith(prefix) || !name.endsWith('.atm-tmp'))
            continue;
        const full = path.join(directory, name);
        rmSync(full, { force: true });
        removed.push(full);
    }
    return removed;
}
function replaceFileAtomically(targetPath, content) {
    const temporary = temporarySibling(targetPath);
    const mode = statSync(targetPath).mode;
    try {
        // Write the sibling to completion, then rename over the target. On POSIX
        // that rename is the concurrent-visibility boundary: readers see the old
        // file or the new file, never a short write with a stale tail. Durability
        // across power loss matches the previous writeFileSync, which also did not
        // fsync; fsync stays off so the uncontended path stays a few syscalls.
        writeFileSync(temporary, content, { encoding: 'utf8', mode: mode & 0o777 });
        renameSync(temporary, targetPath);
    }
    catch (error) {
        rmSync(temporary, { force: true });
        throw error;
    }
}
function throwCommitFault(entry, fault) {
    const temporary = temporarySibling(entry.targetPath);
    try {
        if (fault.kind === 'partial-temp') {
            const fd = openSync(temporary, 'w');
            try {
                const bytes = Buffer.from(entry.content, 'utf8').subarray(0, Math.max(0, fault.byteCount));
                writeSync(fd, bytes);
            }
            finally {
                closeSync(fd);
            }
            throw new Error(`injected partial canonical temp write before rename: ${fault.byteCount} bytes`);
        }
        writeFileSync(temporary, entry.content, 'utf8');
        throw new Error(`injected commit fault before atomic rename: ${entry.filePath}`);
    }
    finally {
        rmSync(temporary, { force: true });
    }
}
function temporarySibling(targetPath) {
    return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${randomBytes(6).toString('hex')}.atm-tmp`);
}
function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
