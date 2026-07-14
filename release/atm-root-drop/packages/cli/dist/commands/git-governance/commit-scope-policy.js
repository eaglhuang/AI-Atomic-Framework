export function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}
export function uniqueSorted(values) {
    return [...new Set(values.map(normalizeRelativePath).filter(Boolean))].sort();
}
export function pathMatchesTaskScope(filePath, scope) {
    const file = normalizeRelativePath(filePath).toLowerCase();
    const candidate = normalizeRelativePath(scope).toLowerCase();
    if (!candidate)
        return false;
    if (candidate.includes('*')) {
        const escaped = candidate
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
            .replace(/\*/g, '[^/]*')
            .replace(/__ATM_DOUBLE_STAR__/g, '.*');
        return new RegExp(`^${escaped}$`).test(file);
    }
    return file === candidate || file.startsWith(`${candidate.replace(/\/$/, '')}/`);
}
export function extractGovernanceTaskIdFromPath(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (!normalized.startsWith('.atm/history/'))
        return null;
    const tasksMatch = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
    if (tasksMatch)
        return tasksMatch[1].toUpperCase();
    const evidenceMatch = normalized.match(/^\.atm\/history\/evidence\/([^/.]+)(?:\.[^/]+)?$/i);
    if (evidenceMatch)
        return evidenceMatch[1].toUpperCase();
    const eventMatch = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
    if (eventMatch)
        return eventMatch[1].toUpperCase();
    return null;
}
export function isProtectedStagedGovernanceOwnershipPath(filePath) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    if (/^\.atm\/history\/evidence\/[^/]+\.bundle-manifest\.json$/.test(normalized)) {
        return false;
    }
    return normalized.startsWith('.atm/history/tasks/')
        || normalized.startsWith('.atm/history/task-events/')
        || normalized.startsWith('.atm/history/evidence/');
}
export function normalizeTaskClaimIntent(value) {
    if (typeof value !== 'string')
        return 'write';
    const normalized = value.trim().toLowerCase();
    return normalized === 'closeout-only' || normalized === 'no-more-mutation' ? 'closeout-only' : 'write';
}
