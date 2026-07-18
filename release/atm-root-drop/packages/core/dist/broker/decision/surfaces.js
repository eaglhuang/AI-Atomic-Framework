export function hasSharedWriteSurface(intent, active) {
    const normalizedFiles = new Set(intent.targetFiles.map(normalizeBrokerPath));
    if (active.resourceKeys.files.some((file) => normalizedFiles.has(normalizeBrokerPath(file))))
        return true;
    return hasIntersection(intent.sharedSurfaces.generators, active.resourceKeys.generators)
        || hasIntersection(intent.sharedSurfaces.projections, active.resourceKeys.projections)
        || hasIntersection(intent.sharedSurfaces.registries, active.resourceKeys.registries)
        || hasIntersection(intent.sharedSurfaces.validators, active.resourceKeys.validators)
        || hasIntersection(intent.sharedSurfaces.artifacts, active.resourceKeys.artifacts);
}
export function hasIntersection(left, right) {
    const values = new Set(left);
    return right.some((value) => values.has(value));
}
export function normalizeBrokerPath(value) {
    return value.trim().replace(/\\/g, '/');
}
