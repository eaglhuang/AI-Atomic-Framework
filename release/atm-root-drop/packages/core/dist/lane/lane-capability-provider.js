import { createHash } from 'node:crypto';
const OPERATION_AUDIENCE = {
    'task-renew': 'task-lifecycle',
    'task-release': 'task-lifecycle',
    'task-handoff': 'task-lifecycle',
    'task-takeover': 'task-lifecycle',
    'governed-commit': 'governed-git',
    'governed-push': 'governed-git',
    'framework-mode-claim': 'framework-mode',
    'framework-mode-release': 'framework-mode',
    'runner-sync-reserve': 'runner-sync',
    'runner-sync-publish': 'runner-sync',
    'taskflow-close': 'taskflow-close'
};
export function audienceForOperation(operation) {
    return OPERATION_AUDIENCE[operation];
}
/**
 * Fingerprint any capability value to a non-invertible, human-readable handle.
 * Shared shape with the lane-session redaction layer so status, diagnostics,
 * dashboards, and receipts expose only fingerprints.
 */
export function capabilityValueFingerprint(value, kind) {
    if (typeof value !== 'string' || value.trim().length === 0)
        return null;
    const digest = createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16);
    return `${kind}fp:${digest}`;
}
function canonicalSubject(subject, tokenId) {
    return [
        subject.audience,
        subject.operation,
        subject.taskId,
        subject.laneId,
        String(subject.generation),
        subject.resource,
        subject.expiresAt,
        tokenId
    ].join('');
}
export function computeBindingHash(subject, tokenId) {
    return createHash('sha256').update(canonicalSubject(subject, tokenId)).digest('hex');
}
/**
 * Mint a capability token bound to a single operation/task/lane/generation/
 * resource/expiry. Only the owner lane (or a governed delegate) should call
 * this; the returned `record` is what the verifier trusts.
 */
export function issueMutationCapability(input) {
    const subject = {
        audience: audienceForOperation(input.operation),
        operation: input.operation,
        taskId: input.taskId,
        laneId: input.laneId,
        generation: input.generation,
        resource: input.resource,
        expiresAt: input.expiresAt
    };
    const bindingHash = computeBindingHash(subject, input.tokenId);
    const token = {
        schemaId: 'atm.laneMutationCapability.v1',
        ...subject,
        tokenId: input.tokenId,
        issuedAt: input.issuedAt,
        bindingHash
    };
    const record = { ...subject, tokenId: input.tokenId, bindingHash };
    return {
        token,
        record,
        tokenFingerprint: capabilityValueFingerprint(input.tokenId, 'capability') ?? 'capabilityfp:unknown'
    };
}
/**
 * The single protected mutation authorization decision. Fail-closed on every
 * ambiguity. Never trusts an actor string, environment variable, or lease id.
 */
export function authorizeMutationCapability(request, snapshot, policy = {}) {
    const audience = audienceForOperation(request.operation);
    const requireToken = policy.requireCapabilityToken ?? true;
    const executingLaneFingerprint = capabilityValueFingerprint(request.executingLaneId, 'lane');
    const ownerLaneFingerprint = capabilityValueFingerprint(snapshot.ownerLaneId, 'lane');
    const resourceFingerprint = capabilityValueFingerprint(request.resource, 'resource') ?? 'resourcefp:none';
    const actorId = normalize(request.actorId);
    const base = {
        schemaId: 'atm.laneMutationCapabilityDecision.v1',
        operation: request.operation,
        audience,
        taskId: request.taskId,
        actorId,
        executingLaneFingerprint,
        ownerLaneFingerprint,
        resourceFingerprint
    };
    const token = request.presentedToken ?? null;
    // 1. A capability token is mandatory. Identity alone is never authority.
    if (!token) {
        if (!requireToken) {
            return {
                ...base,
                allowed: true,
                decisionClass: 'capability-verified',
                errorCode: null,
                tokenFingerprint: null,
                consume: false,
                reason: 'Policy does not require a capability token for this operation.'
            };
        }
        return {
            ...base,
            allowed: false,
            decisionClass: 'capability-required',
            errorCode: 'ATM_LANE_CAPABILITY_REQUIRED',
            tokenFingerprint: null,
            consume: false,
            reason: 'No mutation capability token was presented; actor, lane, env, or lease identity is not sufficient authority.'
        };
    }
    const tokenFingerprint = capabilityValueFingerprint(token.tokenId, 'capability');
    // 2. The token must correspond to a validly issued record with an intact
    //    binding hash. An unknown or forged token grants nothing.
    const record = snapshot.issuedTokens.find((entry) => entry.tokenId === token.tokenId) ?? null;
    const expectedBinding = computeBindingHash(subjectOf(token), token.tokenId);
    if (!record || record.bindingHash !== token.bindingHash || expectedBinding !== token.bindingHash) {
        return {
            ...base,
            allowed: false,
            decisionClass: 'capability-required',
            errorCode: 'ATM_LANE_CAPABILITY_REQUIRED',
            tokenFingerprint,
            consume: false,
            reason: 'Presented token is unknown or its binding hash does not verify against the issued subject.'
        };
    }
    // 3. Subject binding: audience, operation, task, lane, and resource must all
    //    match both the request and the issued record. Any drift is a mismatch —
    //    a token for one mutation can never authorize another.
    const subjectMismatch = record.audience !== audience ||
        record.operation !== request.operation ||
        record.taskId !== request.taskId ||
        record.resource !== request.resource ||
        token.audience !== audience ||
        token.operation !== request.operation ||
        token.taskId !== request.taskId ||
        token.resource !== request.resource ||
        token.laneId !== record.laneId;
    if (subjectMismatch) {
        return {
            ...base,
            allowed: false,
            decisionClass: 'capability-subject-mismatch',
            errorCode: 'ATM_LANE_CAPABILITY_SUBJECT_MISMATCH',
            tokenFingerprint,
            consume: false,
            reason: 'Capability subject does not match the requested operation, task, lane, or resource.'
        };
    }
    // 4. Replay + generation: an already-consumed token or a stale generation
    //    fails closed.
    const stale = record.generation !== snapshot.currentGeneration || token.generation !== snapshot.currentGeneration;
    const alreadyConsumed = snapshot.consumedTokenIds.includes(token.tokenId);
    if (stale || alreadyConsumed) {
        return {
            ...base,
            allowed: false,
            decisionClass: 'capability-replayed',
            errorCode: 'ATM_LANE_CAPABILITY_REPLAYED',
            tokenFingerprint,
            consume: false,
            reason: alreadyConsumed
                ? 'Capability token was already consumed; single-use tokens cannot be replayed.'
                : 'Capability token generation is stale; authority has advanced since it was issued.'
        };
    }
    // 5. Expiry.
    if (isExpired(record.expiresAt, request.now, policy.clockSkewMs ?? 0)) {
        return {
            ...base,
            allowed: false,
            decisionClass: 'capability-replayed',
            errorCode: 'ATM_LANE_CAPABILITY_REPLAYED',
            tokenFingerprint,
            consume: false,
            reason: 'Capability token has expired.'
        };
    }
    // 6. Lane binding: only the lane the token is bound to may execute it, and
    //    that lane must be the owner lane or a governed delegate of it. A second
    //    actor cannot borrow the token from a different lane.
    const executingLaneId = normalize(request.executingLaneId);
    const authorizedLanes = new Set([token.laneId]);
    if (snapshot.ownerLaneId)
        authorizedLanes.add(snapshot.ownerLaneId);
    for (const lane of snapshot.delegatedLaneIds ?? [])
        authorizedLanes.add(lane);
    const laneHolds = Boolean(executingLaneId) && executingLaneId === token.laneId;
    const laneAuthorized = snapshot.ownerLaneId == null || token.laneId === snapshot.ownerLaneId || authorizedLanes.has(token.laneId);
    if (!laneHolds || !laneAuthorized) {
        return {
            ...base,
            allowed: false,
            decisionClass: 'borrowed-actor-blocked',
            errorCode: 'ATM_LANE_CAPABILITY_SUBJECT_MISMATCH',
            tokenFingerprint,
            consume: false,
            reason: 'Executing lane does not hold the capability token, or the token lane is not an authorized owner/delegate lane.'
        };
    }
    // Verified: authorize once and instruct the caller to consume the token.
    return {
        ...base,
        allowed: true,
        decisionClass: 'capability-verified',
        errorCode: null,
        tokenFingerprint,
        consume: true,
        reason: 'Capability token verified: subject-bound, generation-current, unexpired, and lane-held. Consume once.'
    };
}
function subjectOf(token) {
    return {
        audience: token.audience,
        operation: token.operation,
        taskId: token.taskId,
        laneId: token.laneId,
        generation: token.generation,
        resource: token.resource,
        expiresAt: token.expiresAt
    };
}
function isExpired(expiresAt, now, skewMs) {
    const expiry = Date.parse(expiresAt);
    if (Number.isNaN(expiry))
        return true;
    const at = now ? Date.parse(now) : Date.now();
    if (Number.isNaN(at))
        return true;
    return at >= expiry + skewMs;
}
function normalize(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
