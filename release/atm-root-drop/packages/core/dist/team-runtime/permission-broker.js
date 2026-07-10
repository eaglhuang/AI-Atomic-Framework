const BROKER_CONFLICT_MIGRATION = Object.freeze({
    strategy: 'none',
    fromVersion: null,
    notes: 'Team Broker conflict resolution artifact baseline'
});
export function createDefaultTeamPermissionPolicy() {
    return {
        schemaId: 'atm.teamPermissionPolicy.v1',
        repoPolicyId: 'default-governed-policy',
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
            'microsoft-foundry': ['file.read', 'exec.validator']
        },
        defaultDecision: 'deny'
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
        statusCode: 'broker-conflict-blocked'
    };
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
    const ok = globallyAllowed && vendorAllowed && inScope;
    return {
        ok,
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
