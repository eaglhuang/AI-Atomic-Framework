export function hasHistoricalDeliveryWaiver(provenance) {
    return provenance.waivedOutOfScopeFiles.length > 0 && provenance.waiverReason !== null;
}
export function countHistoricalDeliveryFiles(provenance) {
    return new Set([
        ...provenance.taskMatchedFiles,
        ...provenance.governanceFiles,
        ...provenance.allowedRunnerOutputFiles,
        ...provenance.outOfScopeSourceFiles,
        ...provenance.waivedOutOfScopeFiles
    ]).size;
}
