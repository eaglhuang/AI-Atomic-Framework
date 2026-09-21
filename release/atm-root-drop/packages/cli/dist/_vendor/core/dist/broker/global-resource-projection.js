export const RUNNER_SYNC_STEWARD_GENERATOR = 'atm.runner-sync.coalescing-steward';
export const RELEASE_MIRROR_ARTIFACT = 'atm.release-mirror';
export const GIT_INDEX_REGISTRY = 'atm.git-index-lane';
export const BRANCH_COMMIT_QUEUE_REGISTRY = 'atm.branch-commit-queue';
export const GOVERNANCE_BACKLOG_PROJECTION = 'atm.generated-projection.governance-backlog';
export const ATOM_MAP_PROJECTION = 'atm.generated-projection.atom-map';
export const TEAM_VENDOR_HANDOFF_PROJECTION = 'atm.generated-projection.team-vendor-handoff';
const emptySharedSurfaces = Object.freeze({
    generators: [],
    projections: [],
    registries: [],
    validators: [],
    artifacts: []
});
export function projectGovernanceSharedSurfacesFromPaths(paths, options = {}) {
    const generators = new Set();
    const projections = new Set();
    const registries = new Set();
    const validators = new Set();
    const artifacts = new Set();
    if (options.runnerSyncRequired) {
        generators.add(RUNNER_SYNC_STEWARD_GENERATOR);
        artifacts.add(RELEASE_MIRROR_ARTIFACT);
    }
    for (const rawPath of paths) {
        const normalized = normalizePath(rawPath);
        if (!normalized)
            continue;
        if (isReleaseMirrorPath(normalized)) {
            artifacts.add(RELEASE_MIRROR_ARTIFACT);
        }
        if (isRunnerEntrypointPath(normalized)) {
            generators.add(RUNNER_SYNC_STEWARD_GENERATOR);
            artifacts.add(RELEASE_MIRROR_ARTIFACT);
        }
        if (isGitIndexPath(normalized)) {
            registries.add(GIT_INDEX_REGISTRY);
        }
        if (isBranchCommitQueuePath(normalized)) {
            registries.add(BRANCH_COMMIT_QUEUE_REGISTRY);
        }
        const projection = generatedProjectionForPath(normalized);
        if (projection) {
            projections.add(projection);
        }
    }
    return {
        generators: sorted(generators),
        projections: sorted(projections),
        registries: sorted(registries),
        validators: sorted(validators),
        artifacts: sorted(artifacts)
    };
}
export function mergeSharedSurfaces(left, right) {
    return {
        generators: mergeSorted(left?.generators, right?.generators),
        projections: mergeSorted(left?.projections, right?.projections),
        registries: mergeSorted(left?.registries, right?.registries),
        validators: mergeSorted(left?.validators, right?.validators),
        artifacts: mergeSorted(left?.artifacts, right?.artifacts)
    };
}
export function emptyGovernanceSharedSurfaces() {
    return {
        generators: [...emptySharedSurfaces.generators],
        projections: [...emptySharedSurfaces.projections],
        registries: [...emptySharedSurfaces.registries],
        validators: [...emptySharedSurfaces.validators],
        artifacts: [...emptySharedSurfaces.artifacts]
    };
}
function generatedProjectionForPath(normalizedPath) {
    if (normalizedPath === 'docs/governance/atm-bug-and-optimization-backlog.md') {
        return GOVERNANCE_BACKLOG_PROJECTION;
    }
    if (normalizedPath === 'atomic_workbench/atomization-coverage/path-to-atom-map.json') {
        return ATOM_MAP_PROJECTION;
    }
    if (normalizedPath === 'docs/governance/team-agents/cross-vendor-handoff-ledger.md') {
        return TEAM_VENDOR_HANDOFF_PROJECTION;
    }
    return null;
}
function isReleaseMirrorPath(normalizedPath) {
    return normalizedPath.startsWith('release/atm-onefile/')
        || normalizedPath.startsWith('release/atm-root-drop/');
}
function isRunnerEntrypointPath(normalizedPath) {
    return normalizedPath === 'release/atm-onefile/atm.mjs'
        || normalizedPath === 'release/atm-root-drop/atm.mjs'
        || normalizedPath === 'packages/cli/dist/atm.js';
}
function isGitIndexPath(normalizedPath) {
    return normalizedPath === '.git/index'
        || normalizedPath.startsWith('.atm/runtime/git-index-leases/');
}
function isBranchCommitQueuePath(normalizedPath) {
    return normalizedPath.startsWith('.atm/runtime/branch-commit-queue/')
        || normalizedPath.startsWith('.atm/runtime/branch-commit-queues/')
        || normalizedPath.startsWith('.atm/runtime/git-commit-queue/')
        || normalizedPath.startsWith('.atm/runtime/git-commit-queues/')
        || /^\.atm\/runtime\/locks\/git-commit-queue-[^/]+\.lock$/.test(normalizedPath);
}
function mergeSorted(left, right) {
    return sorted(new Set([...(left ?? []), ...(right ?? [])].map(normalizeSurfaceKey).filter(Boolean)));
}
function sorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function normalizePath(value) {
    return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
function normalizeSurfaceKey(value) {
    return value.trim();
}
