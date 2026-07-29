import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { relativePathFrom } from '../shared.js';
import { atomicWriteJson } from './store.js';
import { capabilityFingerprint } from './redaction.js';
/**
 * Non-replayable proxy/takeover receipts.
 *
 * A human or captain approval mints a single-use receipt that delegates one or
 * more mutation command classes from an owner lane to an executor lane for a
 * single task, bounded by a TTL. The receipt records approver, executor lane,
 * owner lane, task, command classes, reason, and expiry. The replayable nonce
 * is never stored; only its hash is persisted so a receipt cannot be forged or
 * replayed after it is consumed.
 */
export const runtimeProxyReceiptsRootRelativePath = '.atm/runtime/lane-proxy-receipts';
export const historyProxyAuditRootRelativePath = '.atm/history/lane-proxy-audit';
export function issueProxyReceipt(input) {
    const cwd = path.resolve(input.cwd);
    const nowIso = normalizeIsoString(input.now) ?? new Date().toISOString();
    const nonce = normalizeOptionalString(input.nonce) ?? randomBytes(24).toString('hex');
    const commandClasses = normalizeCommandClasses(input.commandClasses);
    if (commandClasses.length === 0) {
        throw new Error('A proxy receipt must delegate at least one command class.');
    }
    const receiptId = createReceiptId({
        ownerLaneId: input.ownerLaneId,
        executorLaneId: input.executorLaneId,
        taskId: input.taskId,
        issuedAt: nowIso,
        nonce
    });
    const receipt = {
        schemaId: 'atm.laneProxyReceipt.v1',
        specVersion: '0.1.0',
        receiptId,
        grantKind: input.grantKind ?? 'proxy',
        nonceHash: hashNonce(nonce),
        approver: input.approver.trim(),
        executorLaneId: input.executorLaneId.trim(),
        ownerLaneId: input.ownerLaneId.trim(),
        taskId: input.taskId.trim(),
        commandClasses,
        reason: normalizeOptionalString(input.reason) ?? 'proxy execution approved',
        issuedAt: nowIso,
        expiresAt: new Date(Date.parse(nowIso) + normalizePositiveInteger(input.ttlMs, 0)).toISOString(),
        consumedAt: null,
        consumedCommandClass: null
    };
    const absolutePath = proxyReceiptPathFor(cwd, receiptId);
    atomicWriteJson(absolutePath, receipt);
    return { receipt, receiptPath: relativePathFrom(cwd, absolutePath), nonce };
}
/**
 * Return the first usable (unconsumed, unexpired, surface-matching) receipt that
 * delegates {@link FindUsableProxyReceiptInput.commandClass} from the owner lane
 * to the executor lane for the task. Read-only; does not consume.
 */
export function findUsableProxyReceipt(input) {
    const nowMs = Date.parse(normalizeIsoString(input.now) ?? new Date().toISOString());
    const taskId = input.taskId.trim();
    const ownerLaneId = input.ownerLaneId.trim();
    const executorLaneId = input.executorLaneId.trim();
    for (const receipt of listProxyReceipts(input.cwd)) {
        if (receipt.consumedAt)
            continue;
        if (receipt.taskId !== taskId)
            continue;
        if (receipt.ownerLaneId !== ownerLaneId)
            continue;
        if (receipt.executorLaneId !== executorLaneId)
            continue;
        if (!receipt.commandClasses.includes(input.commandClass))
            continue;
        const expiresMs = Date.parse(receipt.expiresAt);
        if (Number.isFinite(expiresMs) && Number.isFinite(nowMs) && nowMs > expiresMs)
            continue;
        return receipt;
    }
    return null;
}
/**
 * Consume a usable receipt for the given command class, marking it non-replayable
 * and writing an immutable audit artifact under `.atm/history/lane-proxy-audit`.
 */
export function consumeProxyReceipt(input) {
    const cwd = path.resolve(input.cwd);
    const usable = findUsableProxyReceipt(input);
    if (!usable)
        return null;
    const nowIso = normalizeIsoString(input.now) ?? new Date().toISOString();
    const consumed = {
        ...usable,
        consumedAt: nowIso,
        consumedCommandClass: input.commandClass
    };
    const receiptAbsolutePath = proxyReceiptPathFor(cwd, usable.receiptId);
    atomicWriteJson(receiptAbsolutePath, consumed);
    const auditRecord = {
        schemaId: 'atm.laneProxyAudit.v1',
        specVersion: '0.1.0',
        receiptId: consumed.receiptId,
        grantKind: consumed.grantKind,
        taskId: consumed.taskId,
        commandClass: input.commandClass,
        approver: consumed.approver,
        executingActorId: normalizeOptionalString(input.executingActorId) ?? null,
        ownerLaneFingerprint: capabilityFingerprint(consumed.ownerLaneId, 'lane'),
        executorLaneFingerprint: capabilityFingerprint(consumed.executorLaneId, 'lane'),
        reason: consumed.reason,
        issuedAt: consumed.issuedAt,
        expiresAt: consumed.expiresAt,
        consumedAt: nowIso
    };
    const auditAbsolutePath = proxyAuditPathFor(cwd, consumed.taskId, `${consumed.receiptId}-${input.commandClass}`);
    atomicWriteJson(auditAbsolutePath, auditRecord);
    return {
        receipt: consumed,
        receiptPath: relativePathFrom(cwd, receiptAbsolutePath),
        auditPath: relativePathFrom(cwd, auditAbsolutePath)
    };
}
export function listProxyReceipts(cwd) {
    const absoluteRoot = path.join(path.resolve(cwd), runtimeProxyReceiptsRootRelativePath);
    if (!existsSync(absoluteRoot))
        return [];
    return readdirSync(absoluteRoot)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readProxyReceiptFile(path.join(absoluteRoot, entry)))
        .filter((entry) => entry !== null)
        .sort((left, right) => left.issuedAt.localeCompare(right.issuedAt));
}
export function proxyReceiptPathFor(cwd, receiptId) {
    return path.join(path.resolve(cwd), runtimeProxyReceiptsRootRelativePath, `${safeFileId(receiptId)}.json`);
}
export function proxyAuditPathFor(cwd, taskId, artifactId) {
    return path.join(path.resolve(cwd), historyProxyAuditRootRelativePath, safeFileId(taskId), `${safeFileId(artifactId)}.json`);
}
export function hashNonce(nonce) {
    return `sha256:${createHash('sha256').update(nonce).digest('hex')}`;
}
function readProxyReceiptFile(filePath) {
    if (!existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (parsed.schemaId !== 'atm.laneProxyReceipt.v1')
            return null;
        const receiptId = normalizeOptionalString(parsed.receiptId);
        const executorLaneId = normalizeOptionalString(parsed.executorLaneId);
        const ownerLaneId = normalizeOptionalString(parsed.ownerLaneId);
        const taskId = normalizeOptionalString(parsed.taskId);
        const nonceHash = normalizeOptionalString(parsed.nonceHash);
        if (!receiptId || !executorLaneId || !ownerLaneId || !taskId || !nonceHash)
            return null;
        return {
            schemaId: 'atm.laneProxyReceipt.v1',
            specVersion: '0.1.0',
            receiptId,
            grantKind: parsed.grantKind === 'takeover' ? 'takeover' : 'proxy',
            nonceHash,
            approver: normalizeOptionalString(parsed.approver) ?? 'unknown-approver',
            executorLaneId,
            ownerLaneId,
            taskId,
            commandClasses: normalizeCommandClasses(parsed.commandClasses),
            reason: normalizeOptionalString(parsed.reason) ?? 'proxy execution approved',
            issuedAt: normalizeIsoString(parsed.issuedAt) ?? new Date(0).toISOString(),
            expiresAt: normalizeIsoString(parsed.expiresAt) ?? new Date(0).toISOString(),
            consumedAt: normalizeIsoString(parsed.consumedAt) ?? null,
            consumedCommandClass: isCommandClass(parsed.consumedCommandClass) ? parsed.consumedCommandClass : null
        };
    }
    catch {
        return null;
    }
}
function createReceiptId(input) {
    const stamp = input.issuedAt.replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
    const digest = createHash('sha256')
        .update(`${input.ownerLaneId}\n${input.executorLaneId}\n${input.taskId}\n${input.issuedAt}\n${input.nonce}`)
        .digest('hex')
        .slice(0, 12);
    return `proxy-${stamp}-${digest}`;
}
function normalizeCommandClasses(value) {
    if (!Array.isArray(value))
        return [];
    const out = new Set();
    for (const entry of value) {
        if (isCommandClass(entry))
            out.add(entry);
    }
    return [...out];
}
function isCommandClass(value) {
    return value === 'taskflow-close-write'
        || value === 'governed-commit'
        || value === 'framework-mode'
        || value === 'runner-sync'
        || value === 'push';
}
function normalizeIsoString(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function normalizePositiveInteger(value, fallback) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}
function safeFileId(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
