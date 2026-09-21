import { isDeferrableGovernanceDirtyFile } from './commit-bundle-assembly.js';
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
export function applyExplicitGovernanceDirtyDeferral(input) {
    if (!input.requested || input.dirtyGuard.governanceTrackedDirtyFiles.length === 0)
        return input.dirtyGuard;
    const deferred = input.dirtyGuard.governanceTrackedDirtyFiles.filter((filePath) => isDeferrableGovernanceDirtyFile(filePath, input.taskId));
    if (deferred.length === 0)
        return input.dirtyGuard;
    const deferredSet = new Set(deferred);
    const blockingTrackedDirtyFiles = input.dirtyGuard.blockingTrackedDirtyFiles.filter((filePath) => !deferredSet.has(filePath));
    return {
        ...input.dirtyGuard,
        ok: blockingTrackedDirtyFiles.length === 0,
        reason: blockingTrackedDirtyFiles.length === 0 ? 'no-blocking-dirty-files' : 'blocking-dirty-files-present',
        blockingTrackedDirtyFiles,
        governanceTrackedDirtyFiles: input.dirtyGuard.governanceTrackedDirtyFiles.filter((filePath) => !deferredSet.has(filePath)),
        advisoryTrackedDirtyFiles: uniqueStrings([...input.dirtyGuard.advisoryTrackedDirtyFiles, ...deferred])
    };
}
