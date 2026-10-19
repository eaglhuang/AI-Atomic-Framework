// Disk format for the cross-process shared compose inbox.
// One open window per target. The lock is the kernel advisory lock; a dead
// holder is released by the OS. Cleanup must not delete a live writer's temp.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock } from './steward-kernel-lock.js';
export function hashComposeBytes(text) {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
export function sharedComposeFileKey(targetFile) {
    return createHash('sha256').update(targetFile, 'utf8').digest('hex').slice(0, 32);
}
export function composeToken(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}
export function assertSafeId(value, label) {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
        throw new Error(`${label} 只能使用英數、點、底線與連字號：${value}`);
    }
}
export function ensureComposeInbox(inboxDir) {
    for (const name of ['locks', 'proposals', 'windows', 'batches', 'receipts', 'entry-points']) {
        mkdirSync(path.join(inboxDir, name), { recursive: true });
    }
}
export function withComposeFileLock(inboxDir, targetFile, waitMs, fn) {
    const lockDir = path.join(inboxDir, 'locks', sharedComposeFileKey(targetFile));
    mkdirSync(lockDir, { recursive: true });
    acquireKernelAdvisoryLock(lockDir, waitMs, 10, targetFile);
    try {
        return fn();
    }
    finally {
        releaseKernelAdvisoryLock(lockDir);
    }
}
export function atomicWriteText(filePath, content) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-compose-${process.pid}-${randomBytes(3).toString('hex')}`);
    writeFileSync(tmp, content);
    return tmp;
}
/** One file fsync plus a best-effort directory fsync. Callers must not count this as a retry. */
export function commitTempFile(tmpPath, filePath) {
    const fd = openSync(tmpPath, 'r+');
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(tmpPath, filePath);
    fsyncDirectory(path.dirname(filePath));
}
export function writeJsonAtomic(filePath, value) {
    const tmp = atomicWriteText(filePath, `${JSON.stringify(value)}\n`);
    commitTempFile(tmp, filePath);
}
export function readJson(filePath) {
    if (!existsSync(filePath))
        return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
export function proposalPath(inboxDir, proposalId) {
    return path.join(inboxDir, 'proposals', `${proposalId}.json`);
}
export function windowPath(inboxDir, targetFile) {
    return path.join(inboxDir, 'windows', `${sharedComposeFileKey(targetFile)}.json`);
}
export function batchPath(inboxDir, batchId) {
    return path.join(inboxDir, 'batches', `${batchId}.json`);
}
export function receiptPath(inboxDir, proposalId) {
    return path.join(inboxDir, 'receipts', `${proposalId}.json`);
}
export function entryPointPath(inboxDir, entryPointId) {
    return path.join(inboxDir, 'entry-points', `${entryPointId}.json`);
}
export function readProposal(inboxDir, proposalId) {
    return readJson(proposalPath(inboxDir, proposalId));
}
export function writeProposal(inboxDir, proposal) {
    writeJsonAtomic(proposalPath(inboxDir, proposal.proposalId), proposal);
}
export function readWindow(inboxDir, targetFile) {
    return readJson(windowPath(inboxDir, targetFile));
}
export function writeWindow(inboxDir, window) {
    writeJsonAtomic(windowPath(inboxDir, window.targetFile), window);
}
export function deleteWindow(inboxDir, targetFile) {
    rmSync(windowPath(inboxDir, targetFile), { force: true });
}
export function readBatch(inboxDir, batchId) {
    return readJson(batchPath(inboxDir, batchId));
}
export function writeBatch(inboxDir, batch) {
    writeJsonAtomic(batchPath(inboxDir, batch.batchId), batch);
}
export function listBatches(inboxDir) {
    return listJson(path.join(inboxDir, 'batches'));
}
export function readReceipt(inboxDir, proposalId) {
    return readJson(receiptPath(inboxDir, proposalId));
}
export function writeReceipt(inboxDir, receipt) {
    const existing = readReceipt(inboxDir, receipt.proposalId);
    if (existing && existing.terminal !== 'reconciliation-incomplete')
        return existing;
    writeJsonAtomic(receiptPath(inboxDir, receipt.proposalId), receipt);
    return readReceipt(inboxDir, receipt.proposalId) ?? receipt;
}
export function listReceipts(inboxDir) {
    return listJson(path.join(inboxDir, 'receipts'));
}
export function readEntryPoint(inboxDir, entryPointId) {
    return readJson(entryPointPath(inboxDir, entryPointId));
}
export function writeEntryPoint(inboxDir, record) {
    writeJsonAtomic(entryPointPath(inboxDir, record.entryPointId), record);
}
export function listEntryPoints(inboxDir) {
    return listJson(path.join(inboxDir, 'entry-points'));
}
export function liveEntryPoints(inboxDir) {
    return listEntryPoints(inboxDir).filter((record) => record.stoppedAt === null);
}
export function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
export function tempOwnerPid(fileName) {
    const match = /\.tmp-compose-(\d+)-[0-9a-f]+$/.exec(fileName);
    if (!match?.[1])
        return null;
    const pid = Number(match[1]);
    return Number.isInteger(pid) ? pid : null;
}
/** Removes compose temps whose owner pid is dead. Live writers' temps stay. */
export function removeComposeTempFiles(directories) {
    const removed = [];
    for (const dir of directories) {
        if (!existsSync(dir))
            continue;
        for (const name of readdirSync(dir)) {
            if (!name.includes('.tmp-compose-'))
                continue;
            const pid = tempOwnerPid(name);
            if (pid !== null && isProcessAlive(pid))
                continue;
            const full = path.join(dir, name);
            rmSync(full, { force: true });
            removed.push(full);
        }
    }
    return removed;
}
export function parentDir(filePath) {
    const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return index <= 0 ? '.' : filePath.slice(0, index);
}
export function readTargetText(targetPath) {
    if (!existsSync(targetPath))
        return '';
    return readFileSync(targetPath, 'utf8');
}
function listJson(dir) {
    if (!existsSync(dir))
        return [];
    const rows = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json'))
            continue;
        const row = readJson(path.join(dir, name));
        if (row)
            rows.push(row);
    }
    return rows;
}
function fsyncDirectory(dir) {
    let fd = null;
    try {
        fd = openSync(dir, 'r');
        fsyncSync(fd);
    }
    catch {
        // Directory fsync is best effort on virtual filesystems. The file fsync already ran.
    }
    finally {
        if (fd !== null)
            closeSync(fd);
    }
}
