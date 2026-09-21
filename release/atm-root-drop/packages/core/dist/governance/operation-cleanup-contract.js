import { createHash, randomUUID } from 'node:crypto';
export function createOperationCleanupReceipt(input) {
    const paths = normalizePaths(input.paths);
    const retryToken = input.disposition === 'recovery-retained' ? `cleanup-${randomUUID()}` : null;
    const base = {
        schemaId: 'atm.operationCleanupReceipt.v1',
        operationId: input.operationId?.trim() || `operation-${randomUUID()}`,
        owner: normalizeOwner(input.owner),
        outcome: input.outcome,
        disposition: input.disposition,
        paths,
        retryToken,
        terminal: input.disposition === 'restored'
    };
    return { ...base, digest: digestReceipt(base) };
}
export function validateOperationCleanupReceipt(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return { ok: false, reason: 'receipt must be an object' };
    const receipt = value;
    if (receipt.schemaId !== 'atm.operationCleanupReceipt.v1')
        return { ok: false, reason: 'schemaId is invalid' };
    if (!receipt.operationId?.trim() || !receipt.owner?.taskId?.trim() || !receipt.owner?.actorId?.trim())
        return { ok: false, reason: 'operation owner is incomplete' };
    if (!Array.isArray(receipt.paths) || receipt.paths.length === 0)
        return { ok: false, reason: 'paths are required' };
    if (receipt.disposition === 'recovery-retained' && (!receipt.retryToken || receipt.terminal !== false))
        return { ok: false, reason: 'recovery receipt must remain resumable' };
    if (receipt.disposition === 'restored' && (receipt.retryToken !== null || receipt.terminal !== true))
        return { ok: false, reason: 'restored receipt must be terminal' };
    const normalized = normalizePaths(receipt.paths);
    if (JSON.stringify(normalized) !== JSON.stringify(receipt.paths))
        return { ok: false, reason: 'paths must be normalized and sorted' };
    const expected = digestReceipt({ schemaId: 'atm.operationCleanupReceipt.v1', operationId: receipt.operationId, owner: normalizeOwner(receipt.owner), outcome: receipt.outcome, disposition: receipt.disposition, paths: normalized, retryToken: receipt.retryToken ?? null, terminal: Boolean(receipt.terminal) });
    return receipt.digest === expected ? { ok: true, reason: null } : { ok: false, reason: 'digest is invalid' };
}
function normalizeOwner(owner) {
    return { taskId: owner.taskId.trim(), actorId: owner.actorId.trim(), laneSessionId: owner.laneSessionId?.trim() || null };
}
function normalizePaths(paths) {
    return [...paths].map((entry) => ({ path: entry.path.replace(/\\/g, '/').replace(/^\.\//, '').trim(), beforeDigest: entry.beforeDigest ?? null, afterDigest: entry.afterDigest ?? null }))
        .filter((entry) => Boolean(entry.path))
        .sort((left, right) => left.path.localeCompare(right.path));
}
function digestReceipt(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
