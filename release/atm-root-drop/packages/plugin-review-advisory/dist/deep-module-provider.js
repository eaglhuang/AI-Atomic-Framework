export const deepModuleProviderInfo = {
    providerId: 'matt-pocock-deep-module-reference',
    providerVersion: '2026-07-24.ed37663',
    providerContract: 'atm.deepModuleRefactorProvider.v1',
    upstreamUrl: 'https://github.com/mattpocock/skills',
    upstreamCommit: 'ed37663cc5fbef691ddfecd080dff42f7e7e350d',
    codebaseDesignDigest: 'sha256:c46b49303a81c7fc8934d0f4fbc44382cdecb73942d85d8d7db3523407fff8fa',
    improveArchitectureDigest: 'sha256:d3682058df92c259b47c36503baa02345d5811758621b5dc03081d5ba0f7b69b',
    license: 'MIT'
};
const actionableTriggers = [
    'repeated-bugs',
    'shotgun-changes',
    'duplicated-policy',
    'caller-complexity',
    'private-internal-tests',
    'missing-test-seam'
];
const vocabulary = ['module', 'interface', 'seam', 'adapter', 'depth', 'leverage', 'locality'];
export function createDeepModuleReviewReport(input) {
    const triggers = dedupe(input.observedFriction.triggers);
    const concreteTriggers = triggers.filter((trigger) => actionableTriggers.includes(trigger));
    const adapterCount = dedupe(input.proposedAdapters).length;
    const hasOnlyFileLength = concreteTriggers.length === 0 && triggers.includes('file-length');
    const hasRequiredAdapterEvidence = adapterCount >= 2;
    const status = hasOnlyFileLength
        ? 'blocked'
        : hasRequiredAdapterEvidence
            ? 'pass'
            : 'follow-up-required';
    const report = {
        schemaId: 'atm.deepModuleReviewReport.v1',
        providerContract: deepModuleProviderInfo.providerContract,
        providerId: deepModuleProviderInfo.providerId,
        providerVersion: deepModuleProviderInfo.providerVersion,
        generatedAt: new Date(0).toISOString(),
        taskId: input.taskId,
        status,
        candidate: {
            ...input.candidate,
            sourcePaths: dedupe(input.candidate.sourcePaths),
            causalValidators: dedupe(input.candidate.causalValidators)
        },
        triggerVerdict: {
            actionableTriggers: concreteTriggers,
            fileLengthAdvisoryOnly: true
        },
        seam: {
            proposedInterface: input.candidate.publicInterface,
            requiresTwoAdapters: true,
            proposedAdapters: dedupe(input.proposedAdapters),
            deletionTest: 'If this module is deleted, the policy and caller complexity must reappear across callers; otherwise the module is too shallow.',
            interfaceTest: 'Replace internals through the proposed interface and assert observable behavior through that interface only.'
        },
        hiddenComplexity: {
            depth: concreteTriggers.length >= 3 ? 'high' : 'medium',
            leverage: 'Concentrate repeated policy behind one interface so callers gain more behavior per fact learned.',
            locality: 'Keep fixes, rollback, and causal validator updates inside the owner atom or map.'
        },
        dependencyClass: dedupe(input.dependencyClasses),
        replaceDontLayerTest: 'Replace old private-internal tests with tests through the proposed interface once the adapters exist; do not layer tests over old shallow modules.',
        rollback: input.candidate.rollback,
        causalValidators: dedupe(input.candidate.causalValidators),
        confidence: status === 'pass' && concreteTriggers.length >= 2 ? 'high' : 'medium'
    };
    return {
        ...report,
        receiptFingerprint: createDeepModuleReviewFingerprint(report)
    };
}
export function createDeepModuleReviewFingerprint(report) {
    const stable = JSON.stringify({
        schemaId: report.schemaId,
        providerContract: report.providerContract,
        providerId: report.providerId,
        providerVersion: report.providerVersion,
        taskId: report.taskId,
        status: report.status,
        moduleId: report.candidate.moduleId,
        sourcePaths: report.candidate.sourcePaths,
        ownerAtomOrMap: report.candidate.ownerAtomOrMap,
        triggerVerdict: report.triggerVerdict,
        dependencyClass: report.dependencyClass,
        adapters: report.seam.proposedAdapters,
        rollback: report.rollback,
        causalValidators: report.causalValidators
    });
    let hash = 0;
    for (let index = 0; index < stable.length; index += 1) {
        hash = (hash * 31 + stable.charCodeAt(index)) >>> 0;
    }
    return `deep-module-review:${hash.toString(16).padStart(8, '0')}`;
}
export function deepModuleProviderVocabulary() {
    return vocabulary;
}
function dedupe(items) {
    return [...new Set(items.filter(Boolean))];
}
