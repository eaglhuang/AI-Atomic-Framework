import { createBrokerTicket, transitionBrokerTicket } from '../broker/ticket-state.js';
import { attachBrokerTicketAuthorizationGrants, authorizeBrokerTicket } from '../broker/ticket-authority/index.js';
const DEFAULT_BROKER_CONFLICT_RESOLUTION_ACTOR_ID = 'atm-team-broker';
const DEFAULT_AUTHORIZATION_RESOURCE_KIND = 'path';
const DEFAULT_AUTHORIZATION_OPERATION = 'write';
const DEFAULT_AUTHORIZATION_GATE = 'git';
const BROKER_CONFLICT_MIGRATION = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'Team Broker conflict resolution artifact baseline'
});
export function createDefaultTeamPermissionPolicy() {
    return {
        schemaId: 'atm.teamPermissionPolicy.v1',
        repoPolicyId: 'default-governed-policy',
        hardGate: true,
        allowedPermissions: [
            'task.lifecycle',
            'git.write',
            'file.read',
            'file.write',
            'exec.validator',
            'evidence.write'
        ],
        vendorPermissions: {
            openai: ['file.read', 'exec.validator'],
            anthropic: ['file.read', 'exec.validator'],
            'azure-openai': ['file.read', 'exec.validator'],
            'claude-code': ['file.read', 'file.write', 'exec.validator'],
            gemini: ['file.read', 'exec.validator'],
            'gemini-direct': ['file.read', 'exec.validator'],
            'microsoft-foundry': ['file.read', 'exec.validator']
        },
        defaultDecision: 'deny'
    };
}
/**
 * Producer-side authority builder. Issues a canonical `atm.brokerTicket.v1`,
 * transitions it to an executable state, and attaches bounded authorization
 * grants covering exactly the declared resource keys. This is the single
 * source of truth for what a resolution artifact's authority envelope
 * contains; `evaluateBrokerConflictResolutionAuthority` below is the matching
 * consumer-side check over the same shape.
 */
function buildBrokerConflictResolutionAuthority(input) {
    const conflictFiles = uniqueNonEmpty(input.conflictFiles);
    if (conflictFiles.length === 0) {
        throw new Error('Broker conflict resolution requires at least one bounded resource key (conflictFiles).');
    }
    const resourceKey = conflictFiles.slice().sort().join('|');
    const createdTicket = createBrokerTicket({
        taskId: input.primaryTaskId,
        actorId: input.actorId,
        resourceKey,
        now: input.createdAt
    });
    const { ticket: readyTicket } = transitionBrokerTicket({
        ticket: createdTicket,
        to: 'ready',
        actorId: input.actorId,
        reason: 'broker-conflict-resolution-authority-issued',
        idempotencyKey: `bcr-ready-${createdTicket.ticketId}`,
        now: input.createdAt
    });
    const brokerTicket = attachBrokerTicketAuthorizationGrants(readyTicket, [
        {
            resourceKind: input.resourceKind,
            resourceKeys: conflictFiles,
            operations: [input.operation],
            gates: [input.gate]
        }
    ]);
    return {
        brokerTicket,
        authorityGeneration: brokerTicket.authorityGeneration,
        authorityDigest: brokerTicket.authorityDigest,
        conflictFiles,
        authorizationResourceKind: input.resourceKind,
        authorizationOperation: input.operation,
        authorizationGate: input.gate
    };
}
export function createBrokerConflictResolutionArtifact(input) {
    const primaryTaskId = normalizeRequiredId(input.primaryTaskId, 'primaryTaskId');
    const conflictingTaskIds = uniqueNonEmpty(input.conflictingTaskIds);
    const sharedPaths = uniqueNonEmpty(input.sharedPaths);
    const defaultReleaseOrder = [primaryTaskId, ...conflictingTaskIds];
    const releaseOrder = uniqueNonEmpty(input.releaseOrder?.length ? input.releaseOrder : defaultReleaseOrder);
    const currentAllowedTaskId = releaseOrder[0] ?? null;
    const blockedTaskIds = releaseOrder.filter((taskId) => taskId !== currentAllowedTaskId);
    const createdAt = input.createdAt?.trim() || new Date().toISOString();
    const decisionClass = input.decisionClass ?? 'serial-release';
    const violationStatus = input.violationStatus ?? 'broker-conflict-blocked';
    const actorId = input.actorId?.trim() || DEFAULT_BROKER_CONFLICT_RESOLUTION_ACTOR_ID;
    const conflictFilesInput = input.conflictFiles?.length ? input.conflictFiles : sharedPaths;
    const authority = buildBrokerConflictResolutionAuthority({
        primaryTaskId,
        actorId,
        conflictFiles: conflictFilesInput,
        resourceKind: input.authorizationResourceKind ?? DEFAULT_AUTHORIZATION_RESOURCE_KIND,
        operation: input.authorizationOperation ?? DEFAULT_AUTHORIZATION_OPERATION,
        gate: input.authorizationGate ?? DEFAULT_AUTHORIZATION_GATE,
        createdAt
    });
    return {
        schemaId: 'atm.brokerConflictResolution.v1',
        specVersion: '0.1.0',
        migration: BROKER_CONFLICT_MIGRATION,
        resolutionId: `BCR-${stableSuffix([primaryTaskId, ...conflictingTaskIds, ...sharedPaths, ...releaseOrder])}`,
        createdAt,
        primaryTaskId,
        conflictingTaskIds,
        sharedPaths,
        decisionClass,
        decisionReason: input.decisionReason.trim(),
        violationStatus,
        releaseOrder,
        currentAllowedTaskId,
        blockedTaskIds,
        artifactType: 'atm.brokerConflictResolution.v1',
        statusCode: 'broker-conflict-blocked',
        ...authority
    };
}
/**
 * Canonical consumer-side authority check. This is the single validator
 * shared by claim admission (`readResolutionAuthorizedForeignTaskIds`) and
 * any other consumer of `atm.brokerConflictResolution.v1`; it must never be
 * reimplemented against a divergent contract. Fails closed (returns a
 * specific non-`authorized` reason, never a silent permissive default) for
 * missing, stale, over-broad, differently ordered, or resource-mismatched
 * artifacts, including pre-ATM-GOV-0255 legacy artifacts that carry no
 * `brokerTicket` at all.
 */
export function evaluateBrokerConflictResolutionAuthority(artifact, taskId) {
    const ticket = artifact.brokerTicket;
    if (!isBrokerTicketWithAuthority(ticket)) {
        return { authorized: false, reason: 'missing-broker-ticket' };
    }
    if (ticket.taskId.toUpperCase() !== taskId.toUpperCase()) {
        return { authorized: false, reason: 'task-mismatch' };
    }
    const authorityGeneration = Number(artifact.authorityGeneration ?? ticket.authorityGeneration);
    const authorityDigest = String(artifact.authorityDigest ?? ticket.authorityDigest);
    const resourceKind = String(artifact.authorizationResourceKind ?? DEFAULT_AUTHORIZATION_RESOURCE_KIND);
    const operation = String(artifact.authorizationOperation ?? DEFAULT_AUTHORIZATION_OPERATION);
    const gate = String(artifact.authorizationGate ?? DEFAULT_AUTHORIZATION_GATE);
    const conflictFilesRaw = artifact.conflictFiles;
    const resourceKeys = Array.isArray(conflictFilesRaw)
        ? conflictFilesRaw.map((entry) => String(entry).replace(/\\/g, '/')).filter(Boolean)
        : [];
    if (resourceKeys.length === 0) {
        return { authorized: false, reason: 'no-bounded-resource-keys' };
    }
    for (const resourceKey of resourceKeys) {
        const decision = authorizeBrokerTicket(ticket, {
            resourceKind,
            resourceKey,
            operation,
            gate,
            expectedAuthorityGeneration: authorityGeneration,
            expectedAuthorityDigest: authorityDigest
        });
        if (!decision.authorized) {
            return { authorized: false, reason: decision.statusCode };
        }
    }
    return { authorized: true, reason: 'authorized' };
}
function isBrokerTicketWithAuthority(value) {
    return Boolean(value
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.schemaId === 'atm.brokerTicket.v1'
        && typeof value.ticketId === 'string'
        && typeof value.taskId === 'string'
        && typeof value.authorityGeneration === 'number'
        && typeof value.authorityDigest === 'string'
        && Array.isArray(value.authorizationGrants));
}
export function decideBrokerConflictResolutionAdmission(artifact, taskId) {
    const normalizedTaskId = normalizeRequiredId(taskId, 'taskId');
    const resolved = artifact.violationStatus === 'resolved';
    const ok = resolved || artifact.currentAllowedTaskId === normalizedTaskId;
    return {
        ok,
        taskId: normalizedTaskId,
        decisionClass: artifact.decisionClass,
        decisionReason: ok
            ? `Task ${normalizedTaskId} is allowed by broker conflict release order.`
            : artifact.decisionReason,
        violationStatus: artifact.violationStatus,
        statusCode: ok && resolved ? 'resolved' : 'broker-conflict-blocked'
    };
}
export function advanceBrokerConflictResolution(artifact, completedTaskId) {
    const normalizedTaskId = normalizeRequiredId(completedTaskId, 'completedTaskId');
    if (artifact.currentAllowedTaskId !== normalizedTaskId) {
        return artifact;
    }
    const remaining = artifact.releaseOrder.filter((taskId) => taskId !== normalizedTaskId);
    const nextAllowedTaskId = remaining[0] ?? null;
    return {
        ...artifact,
        violationStatus: nextAllowedTaskId ? 'broker-conflict-blocked' : 'resolved',
        releaseOrder: remaining,
        currentAllowedTaskId: nextAllowedTaskId,
        blockedTaskIds: remaining.filter((taskId) => taskId !== nextAllowedTaskId)
    };
}
export function decideTeamPermission(policy, request) {
    const globallyAllowed = policy.allowedPermissions.includes(request.permission);
    const vendorAllowed = (policy.vendorPermissions[request.providerId] ?? []).includes(request.permission);
    const inScope = request.scopedPaths.length > 0 || request.permission === 'task.lifecycle' || request.permission === 'git.write';
    const ok = policy.hardGate === true && globallyAllowed && vendorAllowed && inScope;
    return {
        ok,
        hardGate: true,
        gateId: 'ATM_TEAM_PERMISSION_HARD_GATE',
        reason: ok
            ? 'Permission granted through governed broker policy.'
            : 'Permission denied by governed broker policy or missing scoped paths.',
        permission: request.permission,
        providerId: request.providerId
    };
}
function normalizeRequiredId(value, fieldName) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        throw new Error(`${fieldName} is required for broker conflict resolution.`);
    }
    return normalized;
}
function uniqueNonEmpty(values) {
    return [...new Set((values ?? [])
            .flatMap((entry) => String(entry ?? '').split(','))
            .map((entry) => entry.trim())
            .filter(Boolean))];
}
function stableSuffix(values) {
    let hash = 0;
    for (const value of values.join('|')) {
        hash = ((hash << 5) - hash + value.charCodeAt(0)) | 0;
    }
    return Math.abs(hash).toString(36).padStart(6, '0');
}
