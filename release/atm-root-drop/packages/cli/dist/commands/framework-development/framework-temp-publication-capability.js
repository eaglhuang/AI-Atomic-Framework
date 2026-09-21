import { pathMatchesWriteScope } from '../../_vendor/core/dist/broker/write-scope-policy.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { inspectFrameworkTempLockProjection, } from './framework-temp-lock-projection.js';
/** Resolves the framework-only commit surface without exposing lock details to callers. */
export function resolveFrameworkCommitAuthorityContext(input) {
    const laneSessionId = process.env.ATM_LANE_SESSION_ID ?? null;
    const resolution = input.taskExists
        ? { capability: null, summary: emptyFrameworkTempClaimResolution(laneSessionId) }
        : inspectFrameworkTempClaimResolution({ ...input, laneSessionId });
    const capability = resolution.capability;
    return {
        usesFrameworkClaimCommit: capability !== null,
        frameworkClaimRequired: !input.taskExists,
        frameworkClaimFiles: capability?.allowedFiles ?? null,
        frameworkClaimTaskId: capability?.taskId ?? null,
        frameworkClaimResolution: resolution.summary,
    };
}
export function resolveFrameworkTempPublicationCapability(input) {
    return inspectFrameworkTempClaimResolution(input).capability;
}
function inspectFrameworkTempClaimResolution(input) {
    const taskId = input.taskId?.trim();
    const actorId = input.actorId?.trim() ?? '';
    const laneSessionId = input.laneSessionId?.trim() ?? '';
    const scan = inspectFrameworkTempLockProjection(input.cwd, input.now);
    const observedOwned = scan.locks.filter((candidate) => (!taskId || candidate.workItemId === taskId) &&
        (!actorId || candidate.actorId === actorId));
    const owned = observedOwned.filter((candidate) => candidate.disposition === 'foreign-live');
    // ATM-GOV-0395: a lane matches only on an explicitly recorded lane. A lock
    // whose producer never recorded one is of unknown lane, not of a different
    // lane, so it cannot be silently excluded — that is what left an actor
    // unable to use a claim it was holding. It is equally unsafe to trust: the
    // reconciliation below admits it only when the actor's ownership is
    // unambiguous, and anything ambiguous stays out and fails closed upstream.
    const candidates = laneSessionId
        ? admitLaneBoundCandidates(owned, laneSessionId)
        : taskId
            ? owned
            : admitCanonicalNoLaneCandidate(owned, actorId);
    // A task id already provides a canonical authority key.  A taskless
    // publication must instead be unique after lane binding; guessing among an
    // actor's other live claims would permit receipt/lock identity drift.
    const lock = candidates.length === 1 ? candidates[0] : null;
    return {
        capability: lock ? toCapability(input.cwd, lock) : null,
        summary: {
            laneSessionId: laneSessionId || null,
            lockScan: {
                lockRootExists: scan.lockRootExists,
                discoveredLockFileCount: scan.discoveredLockFileCount,
                readableLockFileCount: scan.readableLockFileCount,
                unreadableLockFiles: scan.unreadableLockFiles,
            },
            observedOwnedLockCount: observedOwned.length,
            staleOwnedClaimCount: observedOwned.filter((candidate) => candidate.disposition === 'stale-recovery-input').length,
            staleOwnedTaskIds: observedOwned
                .filter((candidate) => candidate.disposition === 'stale-recovery-input')
                .map((candidate) => candidate.workItemId)
                .sort(),
            liveOwnedClaimCount: owned.length,
            eligibleClaimCount: candidates.length,
            liveOwnedTaskIds: owned.map((candidate) => candidate.workItemId).sort(),
            eligibleTaskIds: candidates.map((candidate) => candidate.workItemId).sort(),
        },
    };
}
function emptyFrameworkTempClaimResolution(laneSessionId) {
    return {
        laneSessionId: laneSessionId?.trim() || null,
        lockScan: {
            lockRootExists: false,
            discoveredLockFileCount: 0,
            readableLockFileCount: 0,
            unreadableLockFiles: [],
        },
        observedOwnedLockCount: 0,
        staleOwnedClaimCount: 0,
        staleOwnedTaskIds: [],
        liveOwnedClaimCount: 0,
        eligibleClaimCount: 0,
        liveOwnedTaskIds: [],
        eligibleTaskIds: [],
    };
}
/**
 * ATM-GOV-0395 — reconcile a caller's lane against locks of mixed provenance.
 *
 * Locks that recorded this lane are admitted outright. Legacy locks, which
 * recorded no lane at all, are admitted only when the caller's own recorded
 * locks say nothing that contradicts them: if any lock already binds this
 * actor to this lane, the legacy one is a leftover and must not compete. That
 * keeps a single unambiguous owner in every case, and leaves ambiguity — more
 * than one surviving candidate — to fail closed at the single-candidate rule
 * below, rather than being resolved by guessing.
 */
function admitLaneBoundCandidates(owned, laneSessionId) {
    const recordedForThisLane = owned.filter((candidate) => candidate.laneProvenance === 'recorded' && candidate.laneSessionId === laneSessionId);
    if (recordedForThisLane.length > 0)
        return recordedForThisLane;
    const recordedForAnotherLane = owned.some((candidate) => candidate.laneProvenance === 'recorded');
    if (recordedForAnotherLane)
        return [];
    return owned.filter((candidate) => candidate.laneProvenance === 'unrecorded-legacy');
}
/**
 * A taskless command without ATM_LANE_SESSION_ID is not lane-agnostic: it is
 * bound to the canonical no-lane temporary lock that framework-mode claim
 * creates for that actor.  Other lane-bound claims must not make that exact
 * lock ambiguous, nor may they be selected as a substitute for it.
 */
function admitCanonicalNoLaneCandidate(owned, actorId) {
    const workItemId = `ATM-FRAMEWORK-TEMP-${sanitizeFrameworkTempActorKey(actorId)}`;
    const canonical = owned.filter((candidate) => candidate.workItemId === workItemId
        && candidate.laneSessionId === null);
    if (canonical.length > 0)
        return canonical;
    // A historical producer could derive a lane-qualified work-item id before
    // persisting the resolved lane in the lock record.  It is not safe to infer
    // that missing lane as the caller's lane, but a single live unrecorded lock
    // for this actor is still an unambiguous no-lane authority.  More than one
    // remains ambiguous and therefore fails closed.
    const unrecorded = owned.filter((candidate) => candidate.laneSessionId === null);
    return unrecorded.length === 1 ? unrecorded : [];
}
function sanitizeFrameworkTempActorKey(value) {
    return value.trim()
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'actor';
}
export function frameworkTempPublicationCapabilityCovers(capability, files) {
    return Boolean(capability &&
        files.every((file) => capability.allowedFiles.some((scope) => pathMatchesWriteScope(file, scope))));
}
function toCapability(cwd, lock) {
    if (!lock.heartbeatAt || lock.ttlSeconds === null)
        return null;
    const receiptPath = `.atm/history/evidence/${lock.workItemId}.runner-sync-receipt.json`;
    return {
        taskId: lock.workItemId,
        actorId: lock.actorId,
        laneSessionId: lock.laneSessionId,
        heartbeatAt: lock.heartbeatAt,
        ttlSeconds: lock.ttlSeconds,
        // A runner-sync receipt is part of the sealed publication proof, not
        // optional residue. Keep this derivation at the capability boundary so
        // callers cannot accidentally publish bytes without their receipt.
        allowedFiles: [
            ...lock.files.map((scope) => normalizeDirectoryScope(cwd, scope)),
            // A live framework temporary lock is the sole producer of its own
            // runner-sync receipt.  Requiring that not-yet-written receipt to
            // already appear in lock.files creates a circular publication denial.
            // This grants only the lock's exact receipt; foreign receipts still
            // require linked-task or queue-bound proof below.
            receiptPath,
            ...(lock.linkedTaskId
                ? [`.atm/history/evidence/${lock.linkedTaskId}.runner-sync-receipt.json`]
                : []),
            ...resolveReceiptBoundGeneratedOutputPaths(cwd, lock),
            ...resolveQueueBoundTerminalReceiptPaths(cwd, lock),
        ],
    };
}
/** A historical receipt can widen only the lock that explicitly claims it. */
export function frameworkLockClaimsRunnerReceipt(lock) {
    const receiptPath = `.atm/history/evidence/${lock.workItemId}.runner-sync-receipt.json`;
    return lock.files.some((scope) => pathMatchesWriteScope(receiptPath, scope));
}
/**
 * A sealed runner receipt is the authority for its generated output set.  A
 * release manifest is only a projection and can lag the actual build delta.
 * Accept no path unless the live lock, receipt identity, and owned-current
 * inventory entry all agree.
 */
function resolveReceiptBoundGeneratedOutputPaths(cwd, lock) {
    const receiptPath = `.atm/history/evidence/${lock.workItemId}.runner-sync-receipt.json`;
    const absolute = path.join(cwd, receiptPath);
    if (!existsSync(absolute))
        return [];
    try {
        const receipt = JSON.parse(readFileSync(absolute, 'utf8'));
        if (receipt.schemaId !== 'atm.runnerSyncReceipt.v1' || receipt.taskId !== lock.workItemId || receipt.actorId !== lock.actorId)
            return [];
        const inventory = receipt.outputInventory;
        if (!inventory || typeof inventory !== 'object' || !Array.isArray(inventory.entries))
            return [];
        return inventory.entries.flatMap((entry) => {
            if (!entry || typeof entry !== 'object')
                return [];
            const record = entry;
            const outputPath = typeof record.path === 'string' ? record.path : '';
            return record.disposition === 'owned-current' && outputPath && !path.isAbsolute(outputPath) && !outputPath.startsWith('../')
                ? [outputPath.replace(/\\/g, '/')]
                : [];
        });
    }
    catch {
        return [];
    }
}
/**
 * A completed task has no live task lease.  It may nevertheless retain one
 * narrow publication continuation when a live framework lock, queue-head and
 * sealed receipt all agree.  This derives capability from durable facts rather
 * than treating a terminal task as generally writable.
 */
function resolveQueueBoundTerminalReceiptPaths(cwd, lock) {
    const queuePath = path.join(cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json');
    if (!existsSync(queuePath))
        return [];
    try {
        const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
        if (!Array.isArray(queue.groups))
            return [];
        return queue.groups.flatMap((group) => {
            if (!group || typeof group !== 'object')
                return [];
            const candidate = group;
            if (candidate.queuePosition !== 1 || typeof candidate.stewardWorkId !== 'string' || typeof candidate.sealedSourceSha !== 'string' || !Array.isArray(candidate.requests))
                return [];
            return candidate.requests.flatMap((request) => {
                if (!request || typeof request !== 'object')
                    return [];
                const entry = request;
                const taskId = typeof entry.taskId === 'string' ? entry.taskId.trim() : '';
                if (!taskId || entry.actorId !== lock.actorId || entry.sealedSourceSha !== candidate.sealedSourceSha || !isTerminalTask(cwd, taskId))
                    return [];
                const receiptPath = `.atm/history/evidence/${taskId}.runner-sync-receipt.json`;
                const receipt = readQueueBoundReceipt(cwd, receiptPath);
                return receipt
                    && receipt.taskId === taskId
                    && receipt.actorId === lock.actorId
                    && receipt.stewardWorkId === candidate.stewardWorkId
                    && receipt.sealedSourceSha === candidate.sealedSourceSha
                    ? [receiptPath]
                    : [];
            });
        });
    }
    catch {
        return [];
    }
}
function isTerminalTask(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return false;
    try {
        const task = JSON.parse(readFileSync(taskPath, 'utf8'));
        return task.status === 'done' || task.status === 'review' || task.status === 'abandoned';
    }
    catch {
        return false;
    }
}
function readQueueBoundReceipt(cwd, receiptPath) {
    const absolute = path.join(cwd, receiptPath);
    if (!existsSync(absolute))
        return null;
    try {
        const receipt = JSON.parse(readFileSync(absolute, 'utf8'));
        return receipt.schemaId === 'atm.runnerSyncReceipt.v1' ? receipt : null;
    }
    catch {
        return null;
    }
}
function normalizeDirectoryScope(cwd, scope) {
    if (scope.endsWith('/**'))
        return scope;
    const absolute = path.join(cwd, scope);
    try {
        return existsSync(absolute) && statSync(absolute).isDirectory()
            ? `${scope}/**`
            : scope;
    }
    catch {
        return scope;
    }
}
