import { normalizeRelativePath } from './commit-scope-policy.js';
export function isDeferrableForeignGovernanceResidue(taskId, finding) {
    const ownerTaskId = finding.ownerTaskId?.trim().toUpperCase() ?? null;
    if (!ownerTaskId || ownerTaskId === taskId.trim().toUpperCase())
        return false;
    const normalized = normalizeRelativePath(finding.path).toLowerCase();
    return /^\.atm\/history\/evidence\/[^/]+\.(?:bundle-manifest|closure-packet)\.json$/.test(normalized)
        || /^\.atm\/history\/task-events\/[^/]+\/.+(?:close|reconcile|repair-closure).+\.json$/.test(normalized);
}
export function isActionableManualResidue(filePath) {
    const lower = normalizeRelativePath(filePath).toLowerCase();
    return lower.startsWith('.atm/runtime/snapshots/')
        || /^\.atm\/history\/reports\/.+\.json$/.test(lower)
        || /^\.atm\/history\/protected-override-audit\/.+\.json$/.test(lower)
        || /^\.atm\/history\/evidence\/[^/]+\.bundle-manifest\.json$/.test(lower)
        || /^\.atm\/history\/evidence\/[^/]+\.closure-packet\.json$/.test(lower)
        || /^\.atm\/history\/task-events\/[^/]+\/.+(?:close|reconcile|repair-closure).+\.json$/.test(lower);
}
