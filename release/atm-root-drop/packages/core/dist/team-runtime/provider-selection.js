export function resolveTeamProviderSelection(role, config) {
    const override = config.roleOverrides[role];
    if (override) {
        return {
            role,
            source: 'role-override',
            ...override
        };
    }
    return {
        role,
        source: 'repo-default',
        ...config.repoDefault
    };
}
