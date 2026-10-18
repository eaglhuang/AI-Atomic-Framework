import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
/**
 * A scope entry confers entitlement only if it names a bounded location. A
 * blanket pattern is an artifact of how a claim was written, not evidence that
 * anyone considered this path — honouring it would hand every framework claim
 * authority over every closed task at once.
 */
function isBoundedScopeEntry(entry) {
    const normalized = entry.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!normalized)
        return false;
    const wildcardIndex = normalized.search(/[*?]/);
    if (wildcardIndex === -1)
        return true;
    const prefix = normalized.slice(0, wildcardIndex);
    // Require the fixed part to reach past a top-level directory, so `.atm/**`
    // and `**` are rejected while `.atm/history/evidence/<task>.*` is accepted.
    return prefix.split('/').filter(Boolean).length >= 3;
}
function scopeEntryMatches(candidateFile, entry) {
    const file = candidateFile.replace(/\\/g, '/').toLowerCase();
    const pattern = entry.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();
    if (pattern.endsWith('/**')) {
        const prefix = pattern.slice(0, -3);
        return file === prefix || file.startsWith(`${prefix}/`);
    }
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        return file.startsWith(`${prefix}/`) && !file.slice(prefix.length + 1).includes('/');
    }
    if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        return file.startsWith(`${prefix}.`) && !file.slice(prefix.length + 1).includes('/');
    }
    return file === pattern;
}
function readWriterClaim(cwd, writerWorkItemId, now) {
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${writerWorkItemId}.lock.json`);
    if (!existsSync(lockPath))
        return null;
    try {
        const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
        const released = lock.released === true || lock.status === 'released';
        const heartbeatAt = typeof lock.heartbeatAt === 'string' ? Date.parse(lock.heartbeatAt) : Number.NaN;
        const ttlSeconds = typeof lock.ttlSeconds === 'number' && Number.isFinite(lock.ttlSeconds) ? lock.ttlSeconds : null;
        const fresh = Number.isFinite(heartbeatAt) && ttlSeconds !== null && now - heartbeatAt <= ttlSeconds * 1000;
        const linked = typeof lock.linkedTaskId === 'string' && lock.linkedTaskId.trim() ? lock.linkedTaskId.trim() : null;
        return {
            files: Array.isArray(lock.files) ? lock.files.filter((entry) => typeof entry === 'string') : [],
            linkedTaskId: linked,
            live: !released && fresh
        };
    }
    catch {
        return null;
    }
}
/**
 * Resolve whether a writer may reconcile one path belonging to a terminal task.
 *
 * Fail-closed in every direction: an unreadable claim, a dead claim, an
 * unbounded scope, a missing linkage, or a linkage to a card that is itself
 * terminal all leave the path protected.
 */
export function hasReconciliationEntitlement(cwd, input, now = Date.now()) {
    const writerWorkItemId = input.writerWorkItemId?.trim();
    if (!writerWorkItemId)
        return false;
    const claim = readWriterClaim(cwd, writerWorkItemId, now);
    if (!claim || !claim.live)
        return false;
    const admitted = claim.files.some((entry) => isBoundedScopeEntry(entry) && scopeEntryMatches(input.candidateFile, entry));
    if (!admitted)
        return false;
    // The linkage is what makes the write answerable. A normal task claim is
    // itself a durable, live review surface, so its own id is the anchor when
    // no framework-temporary linkage is present. A framework temporary claim
    // does not have a task ledger and therefore remains blocked unless it names
    // a live linked task explicitly.
    const writerHasLiveTaskLedger = existsSync(path.join(cwd, '.atm', 'history', 'tasks', `${writerWorkItemId}.json`)) && input.isLiveTask(writerWorkItemId);
    const answerableTaskId = claim.linkedTaskId
        ?? (writerHasLiveTaskLedger ? writerWorkItemId : null);
    return Boolean(answerableTaskId && input.isLiveTask(answerableTaskId));
}
