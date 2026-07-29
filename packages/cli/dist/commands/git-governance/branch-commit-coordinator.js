import { createHash } from 'node:crypto';
function fingerprint(value, kind) {
    if (typeof value !== 'string' || value.trim().length === 0)
        return null;
    return `${kind}fp:${createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16)}`;
}
function normalizeCandidates(files) {
    return [...new Set(files.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
}
function isExpired(expiresAt, now) {
    const expiry = Date.parse(expiresAt);
    if (Number.isNaN(expiry))
        return true;
    const at = now ? Date.parse(now) : Date.now();
    return Number.isNaN(at) ? true : at >= expiry;
}
/**
 * Decide the branch commit-window action. Fail-closed: when another live owner
 * holds the window the caller waits; reclaim is only offered against a proven
 * dead/expired owner at an unchanged fenced generation.
 */
export function coordinateBranchCommit(request, snapshot) {
    const candidateSet = normalizeCandidates(request.candidateFiles);
    const executingLane = normalize(request.executingLaneSessionId);
    const ownerLane = snapshot.owner ? snapshot.owner.laneSessionId : null;
    // Idempotency binds branch + task + lane + generation + candidate digest, so a
    // retried identical request maps to the same window operation.
    const idempotencyKey = createHash('sha256')
        .update([request.branch, request.taskId, executingLane ?? '', String(snapshot.currentGeneration), candidateSet.join(',')].join('\n'))
        .digest('hex')
        .slice(0, 24);
    // The fencing token binds the generation; a stale-generation holder cannot act.
    const fencingToken = `fence:${snapshot.currentGeneration}:${createHash('sha256').update(`${request.branch}\n${executingLane ?? ''}\n${snapshot.currentGeneration}`).digest('hex').slice(0, 16)}`;
    const base = {
        schemaId: 'atm.branchCommitPlan.v1',
        branch: request.branch,
        taskId: request.taskId,
        fencingToken,
        idempotencyKey,
        candidateSet,
        executingLaneFingerprint: fingerprint(executingLane, 'lane'),
        ownerLaneFingerprint: fingerprint(ownerLane, 'lane')
    };
    const reclaimCommand = `node atm.mjs git commit --actor ${request.actorId ?? '<actor>'} --task ${request.taskId} --lane-session "$ATM_LANE_SESSION_ID" --json`;
    const waitCommand = `node atm.mjs broker status --json  # branch ${request.branch} commit window held; retry when free`;
    // No executing lane capability -> cannot bind authority to an actor string.
    if (!executingLane) {
        return {
            ...base,
            action: 'wait',
            allowed: false,
            recoveryCommand: waitCommand,
            reason: 'No executing lane capability present; branch commit authority cannot bind to an actor string.'
        };
    }
    // Release path: the caller owns the window and is finishing.
    if (request.releasing) {
        const ownsWindow = ownerLane === executingLane && snapshot.owner?.generation === snapshot.currentGeneration;
        return {
            ...base,
            action: 'release',
            allowed: ownsWindow,
            recoveryCommand: reclaimCommand,
            reason: ownsWindow
                ? 'Executing lane owns the current-generation window; release is authorized.'
                : 'Release requested but executing lane does not hold the current-generation window.'
        };
    }
    // Free window -> acquire.
    if (!snapshot.owner) {
        return {
            ...base,
            action: 'acquire',
            allowed: true,
            recoveryCommand: reclaimCommand,
            reason: 'Branch commit window is free; acquire at the current fenced generation.'
        };
    }
    // Executing lane already owns the window at the live generation -> acquire (idempotent re-entry).
    if (ownerLane === executingLane && snapshot.owner.generation === snapshot.currentGeneration) {
        return {
            ...base,
            action: 'acquire',
            allowed: true,
            recoveryCommand: reclaimCommand,
            reason: 'Executing lane already holds the current-generation window; re-entry is idempotent.'
        };
    }
    // A different owner holds the window. Reclaim is allowed ONLY against a proven
    // dead/expired owner at an unchanged fenced generation — even if HEAD did not
    // move (the orphan-lock incident). Otherwise wait.
    const ownerDead = snapshot.owner.liveness === 'dead';
    const ownerExpired = isExpired(snapshot.owner.expiresAt, request.now);
    const generationUnchanged = snapshot.owner.generation === snapshot.currentGeneration;
    if ((ownerDead || ownerExpired) && generationUnchanged) {
        return {
            ...base,
            action: 'reclaim',
            allowed: true,
            recoveryCommand: reclaimCommand,
            reason: ownerDead
                ? 'Prior owner is proven dead at an unchanged fenced generation; reclaim without manual lock deletion (HEAD movement not required).'
                : 'Prior owner lease expired at an unchanged fenced generation; reclaim without manual lock deletion.'
        };
    }
    return {
        ...base,
        action: 'wait',
        allowed: false,
        recoveryCommand: waitCommand,
        reason: snapshot.owner.liveness === 'live'
            ? 'Another live lane holds the branch commit window; wait for release.'
            : 'Branch commit window held by another lane; owner not proven dead/expired at the current generation, so reclaim is refused. Wait or re-probe liveness.'
    };
}
function normalize(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
