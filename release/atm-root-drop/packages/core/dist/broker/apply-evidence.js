export const defaultStewardApplyMigration = {
    strategy: 'none',
    fromVersion: null,
    notes: 'neutral write steward apply'
};
export function buildStewardApplyEvidence(input) {
    return {
        schemaId: 'atm.stewardApplyEvidence.v1',
        specVersion: '0.1.0',
        migration: defaultStewardApplyMigration,
        stewardId: input.stewardId,
        mergePlanId: input.mergePlan.mergePlanId,
        proposalIds: [...input.proposalIds].sort((left, right) => left.localeCompare(right)),
        targetFiles: [...input.targetFiles].sort((left, right) => left.localeCompare(right)),
        appliedFiles: [...input.appliedFiles].sort((left, right) => left.localeCompare(right)),
        fileBeforeHashes: input.fileBeforeHashes,
        fileAfterHashes: input.fileAfterHashes,
        permissions: {
            fileWrite: [...input.targetFiles].sort((left, right) => left.localeCompare(right)),
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false
        },
        applyMethod: input.mergePlan.applyMethod,
        verdict: input.verdict,
        blockedReasons: input.blockedReasons ? [...input.blockedReasons] : undefined,
        // Omit the field entirely when not supplied so existing deepEqual-based
        // evidence tests (which do not expect the key) keep passing.
        ...(input.mutationEvidence ? { mutationEvidence: [...input.mutationEvidence] } : {}),
        ...(input.brokerOperationRun ? { brokerOperationRun: input.brokerOperationRun } : {})
    };
}
