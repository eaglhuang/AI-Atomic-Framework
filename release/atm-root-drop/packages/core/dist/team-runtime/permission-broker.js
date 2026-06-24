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
            'azure-openai': ['file.read', 'exec.validator'],
            'claude-code': ['file.read', 'file.write', 'exec.validator'],
            gemini: ['file.read', 'exec.validator'],
            'microsoft-foundry': ['file.read', 'exec.validator']
        },
        defaultDecision: 'deny'
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
