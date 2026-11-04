/**
 * File-level claim share layer (prereg v3 W4, Q1-Q7).
 *
 * - `claimFiles` always grants. When another live claim covers one of the files the
 *   result is CLAIM_OVERLAP (share mode: no queue, no shrink) and the message names
 *   only the files plus "will be merged via steward" (no actor, no claim id).
 * - The earlier holder learns about the overlap from the output of its next atm
 *   command (`touchClaimShareActor`), logged as `overlap-notice-delivered`.
 * - Leases default to 900 s, renew on every atm command of the holder and are
 *   released when the steward commits that file for the holder.
 * - Writes without a claim are allowed, logged as `unclaimed-write` and auto-claimed.
 *
 * Broker decision logic is not touched; this layer only records and informs.
 */
import { compareResourceKeys } from '../broker/resource-overlap.js';
import { appendClaimEvent } from './claim-event-log.js';
import { defaultClaimTtlSeconds, isClaimShareActive, loadClaimShareRegistry, saveClaimShareRegistry, withClaimShareLock } from './claim-share-store.js';
export function normalizeClaimFile(file) {
    let normalized = String(file).trim().replace(/\\/g, '/');
    while (normalized.startsWith('./'))
        normalized = normalized.slice(2);
    return normalized.replace(/\/{2,}/g, '/');
}
export function claimOverlapMessage(files) {
    return `CLAIM_OVERLAP: ${files.join(', ')} will be merged via steward.`;
}
function filesOverlap(left, right) {
    return compareResourceKeys('file', left, right).verdict === 'overlap';
}
function uniqueFiles(files) {
    return [...new Set(files.map(normalizeClaimFile).filter((file) => file.length > 0))];
}
class ClaimShareSession {
    events = [];
    cwd;
    registry;
    nowMs;
    constructor(cwd, registry, nowMs) {
        this.cwd = cwd;
        this.registry = registry;
        this.nowMs = nowMs;
    }
    get nowIso() {
        return new Date(this.nowMs).toISOString();
    }
    emit(input) {
        const event = appendClaimEvent(this.cwd, this.registry.nextSeq, this.nowMs, input);
        this.registry.nextSeq += 1;
        this.events.push(event);
        return event;
    }
    /** Drops leases whose expiresAt has passed, logging the original expiresAt. */
    sweepExpired() {
        const expired = [];
        const live = [];
        for (const claim of this.registry.claims) {
            if (Date.parse(claim.expiresAt) <= this.nowMs) {
                expired.push(claim.claimId);
                this.emit({
                    type: 'expire',
                    actorId: claim.actorId,
                    claimId: claim.claimId,
                    files: claim.files,
                    detail: { expiresAt: claim.expiresAt, detectedAt: this.nowIso, ttlSeconds: claim.ttlSeconds }
                });
            }
            else {
                live.push(claim);
            }
        }
        this.registry.claims = live;
        return expired;
    }
    findActorClaim(actorId) {
        return this.registry.claims.find((claim) => claim.actorId === actorId) ?? null;
    }
    replaceClaim(next, previousClaimId) {
        const others = this.registry.claims.filter((claim) => claim.claimId !== previousClaimId);
        this.registry.claims = next ? [...others, next] : others;
    }
    claim(actorId, requestedFiles, ttlSeconds, source, detail) {
        const files = uniqueFiles(requestedFiles);
        const existing = this.findActorClaim(actorId);
        const alreadyHeld = new Set(existing?.files ?? []);
        const added = files.filter((file) => !alreadyHeld.has(file));
        const expiresAt = new Date(this.nowMs + ttlSeconds * 1000).toISOString();
        const claimId = existing?.claimId ?? `claim-${String(this.registry.nextClaimNumber++).padStart(4, '0')}`;
        const next = {
            claimId,
            actorId,
            files: [...(existing?.files ?? []), ...added],
            source: existing?.source ?? source,
            claimedAt: existing?.claimedAt ?? this.nowIso,
            renewedAt: this.nowIso,
            expiresAt,
            ttlSeconds
        };
        const overlapFiles = new Set();
        const holderFiles = new Map();
        for (const other of this.registry.claims) {
            if (other.actorId === actorId)
                continue;
            for (const file of added) {
                const hits = other.files.filter((held) => filesOverlap(file, held));
                if (hits.length === 0)
                    continue;
                overlapFiles.add(file);
                const bucket = holderFiles.get(other.claimId) ?? { claim: other, files: new Set() };
                bucket.files.add(file);
                holderFiles.set(other.claimId, bucket);
            }
        }
        this.replaceClaim(next, existing?.claimId ?? null);
        this.emit({
            type: 'claim',
            actorId,
            claimId,
            files: added,
            detail: { ...detail, source, ttlSeconds, expiresAt, heldFiles: next.files }
        });
        const overlapList = [...overlapFiles];
        if (overlapList.length > 0) {
            const relatedClaimIds = [...holderFiles.keys()];
            const overlapEvent = this.emit({
                type: 'claim-overlap',
                actorId,
                claimId,
                files: overlapList,
                relatedClaimIds,
                detail: { source }
            });
            for (const { claim: holder, files: holderOverlap } of holderFiles.values()) {
                const notice = {
                    noticeId: `notice-${overlapEvent.seq}-${holder.claimId}`,
                    holderActorId: holder.actorId,
                    holderClaimId: holder.claimId,
                    files: [...holderOverlap],
                    createdAt: this.nowIso,
                    causeSeq: overlapEvent.seq
                };
                this.registry.pendingNotices.push(notice);
            }
        }
        return {
            code: overlapList.length > 0 ? 'CLAIM_OVERLAP' : 'CLAIM_GRANTED',
            claimId,
            actorId,
            files: next.files,
            overlapFiles: overlapList,
            expiresAt,
            message: overlapList.length > 0 ? claimOverlapMessage(overlapList) : `Claimed ${files.join(', ')} until ${expiresAt}.`
        };
    }
    renew(actorId) {
        const claim = this.findActorClaim(actorId);
        if (!claim)
            return [];
        const expiresAt = new Date(this.nowMs + claim.ttlSeconds * 1000).toISOString();
        this.replaceClaim({ ...claim, renewedAt: this.nowIso, expiresAt }, claim.claimId);
        this.emit({
            type: 'renew',
            actorId,
            claimId: claim.claimId,
            files: claim.files,
            detail: { previousExpiresAt: claim.expiresAt, expiresAt }
        });
        return [claim.claimId];
    }
    deliverNotices(actorId) {
        const mine = this.registry.pendingNotices.filter((notice) => notice.holderActorId === actorId);
        if (mine.length === 0)
            return [];
        this.registry.pendingNotices = this.registry.pendingNotices.filter((notice) => notice.holderActorId !== actorId);
        return mine.map((notice) => {
            this.emit({
                type: 'overlap-notice-delivered',
                actorId,
                claimId: notice.holderClaimId,
                files: notice.files,
                detail: {
                    noticeId: notice.noticeId,
                    causeSeq: notice.causeSeq,
                    createdAt: notice.createdAt,
                    latencyMs: this.nowMs - Date.parse(notice.createdAt)
                }
            });
            return {
                code: 'CLAIM_OVERLAP',
                noticeId: notice.noticeId,
                files: notice.files,
                message: claimOverlapMessage(notice.files),
                createdAt: notice.createdAt,
                deliveredAt: this.nowIso
            };
        });
    }
    release(actorId, files, reason, detail = {}) {
        const claim = this.findActorClaim(actorId);
        if (!claim)
            return [];
        const releaseSet = files ? new Set(uniqueFiles(files)) : new Set(claim.files);
        const released = claim.files.filter((file) => releaseSet.has(file));
        if (released.length === 0)
            return [];
        const remaining = claim.files.filter((file) => !releaseSet.has(file));
        this.replaceClaim(remaining.length > 0 ? { ...claim, files: remaining } : null, claim.claimId);
        if (remaining.length === 0) {
            this.registry.pendingNotices = this.registry.pendingNotices.filter((notice) => notice.holderClaimId !== claim.claimId);
        }
        this.emit({
            type: 'release',
            actorId,
            claimId: claim.claimId,
            files: released,
            detail: { ...detail, reason, remainingFiles: remaining }
        });
        return released;
    }
}
function runSession(cwd, now, fn) {
    if (!isClaimShareActive(cwd))
        return null;
    return withClaimShareLock(cwd, () => {
        const session = new ClaimShareSession(cwd, loadClaimShareRegistry(cwd), (now ?? Date.now)());
        const value = fn(session);
        saveClaimShareRegistry(cwd, session.registry);
        return value;
    });
}
/** Creates the registry, which switches the claim share layer on for this repository. */
export function initClaimShare(cwd) {
    if (isClaimShareActive(cwd))
        return { created: false };
    return withClaimShareLock(cwd, () => {
        if (isClaimShareActive(cwd))
            return { created: false };
        saveClaimShareRegistry(cwd, loadClaimShareRegistry(cwd));
        return { created: true };
    });
}
export function claimFiles(input) {
    return runSession(input.cwd, input.now, (session) => {
        const expiredClaimIds = session.sweepExpired();
        const outcome = session.claim(input.actorId, input.files, input.ttlSeconds ?? defaultClaimTtlSeconds, 'claim', {});
        const notices = session.deliverNotices(input.actorId);
        return { ...outcome, renewedClaimIds: [], expiredClaimIds, notices };
    });
}
/** Per-command hook: sweep expired leases, renew the actor's lease and deliver pending overlap notices. */
export function touchClaimShareActor(input) {
    return runSession(input.cwd, input.now, (session) => {
        const expiredClaimIds = session.sweepExpired();
        const renewedClaimIds = session.renew(input.actorId);
        const notices = session.deliverNotices(input.actorId);
        return { renewedClaimIds, expiredClaimIds, notices };
    });
}
export function releaseClaimFiles(input) {
    return runSession(input.cwd, input.now, (session) => {
        const expiredClaimIds = session.sweepExpired();
        const releasedFiles = session.release(input.actorId, input.files && input.files.length > 0 ? input.files : null, 'explicit');
        return { releasedFiles, expiredClaimIds };
    });
}
export function claimShareStatus(input) {
    return runSession(input.cwd, input.now, (session) => {
        const expiredClaimIds = session.sweepExpired();
        return { claims: [...session.registry.claims], pendingNotices: session.registry.pendingNotices.length, expiredClaimIds };
    });
}
/**
 * Before the steward applies: every write target not covered by the writer's live claim is
 * logged as `unclaimed-write` and auto-claimed (which may raise CLAIM_OVERLAP for the writer).
 */
export function recordUnclaimedWrites(input) {
    return runSession(input.cwd, input.now, (session) => {
        session.sweepExpired();
        const unclaimed = [];
        const overlaps = [];
        for (const write of input.writes) {
            const file = normalizeClaimFile(write.file);
            const claim = session.findActorClaim(write.actorId);
            const covered = claim?.files.some((held) => held === file || filesOverlap(held, file)) ?? false;
            if (covered)
                continue;
            unclaimed.push({ ...write, file });
            session.emit({
                type: 'unclaimed-write',
                actorId: write.actorId,
                claimId: claim?.claimId ?? null,
                files: [file],
                detail: { proposalId: write.proposalId }
            });
            const outcome = session.claim(write.actorId, [file], input.ttlSeconds ?? defaultClaimTtlSeconds, 'unclaimed-write', { proposalId: write.proposalId, autoClaim: true });
            if (outcome.code === 'CLAIM_OVERLAP')
                overlaps.push(outcome);
        }
        return { unclaimed, overlaps };
    });
}
/** After the steward applies: log accept / reject and release the committed file from the writer's claim. */
export function recordStewardOutcomes(input) {
    return runSession(input.cwd, input.now, (session) => {
        const releasedFiles = [];
        for (const write of input.writes) {
            const file = normalizeClaimFile(write.file);
            const accepted = write.decision === 'accepted';
            const claim = session.findActorClaim(write.actorId);
            session.emit({
                type: accepted ? 'steward-accept' : 'steward-reject',
                actorId: write.actorId,
                claimId: claim?.claimId ?? null,
                files: [file],
                detail: { proposalId: write.proposalId, decision: write.decision, reasonCode: write.reasonCode, commitSha: write.commitSha }
            });
            if (accepted && write.commitSha) {
                releasedFiles.push(...session.release(write.actorId, [file], 'commit', { proposalId: write.proposalId, commitSha: write.commitSha }));
            }
        }
        return { releasedFiles };
    });
}
