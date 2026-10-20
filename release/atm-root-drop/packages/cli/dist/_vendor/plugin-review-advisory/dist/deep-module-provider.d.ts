export type DeepModuleTrigger = 'repeated-bugs' | 'shotgun-changes' | 'duplicated-policy' | 'caller-complexity' | 'private-internal-tests' | 'missing-test-seam' | 'file-length';
export type DeepModuleDependencyClass = 'in-process' | 'local-substitutable' | 'remote-owned' | 'true-external';
export interface DeepModuleRefactorCandidate {
    readonly moduleId: string;
    readonly sourcePaths: readonly string[];
    readonly ownerAtomOrMap: string;
    readonly publicInterface: string;
    readonly rollback: string;
    readonly causalValidators: readonly string[];
}
export interface DeepModuleObservedFriction {
    readonly triggers: readonly DeepModuleTrigger[];
    readonly evidenceRefs: readonly string[];
    readonly notes?: readonly string[];
}
export interface DeepModuleReviewProviderInput {
    readonly taskId: string;
    readonly candidate: DeepModuleRefactorCandidate;
    readonly observedFriction: DeepModuleObservedFriction;
    readonly dependencyClasses: readonly DeepModuleDependencyClass[];
    readonly proposedAdapters: readonly string[];
}
export type DeepModuleReviewStatus = 'pass' | 'follow-up-required' | 'blocked';
export interface DeepModuleReviewReport {
    readonly schemaId: 'atm.deepModuleReviewReport.v1';
    readonly providerContract: 'atm.deepModuleRefactorProvider.v1';
    readonly providerId: string;
    readonly providerVersion: string;
    readonly generatedAt: string;
    readonly taskId: string;
    readonly status: DeepModuleReviewStatus;
    readonly candidate: DeepModuleRefactorCandidate;
    readonly triggerVerdict: {
        readonly actionableTriggers: readonly DeepModuleTrigger[];
        readonly fileLengthAdvisoryOnly: boolean;
    };
    readonly seam: {
        readonly proposedInterface: string;
        readonly requiresTwoAdapters: boolean;
        readonly proposedAdapters: readonly string[];
        readonly deletionTest: string;
        readonly interfaceTest: string;
    };
    readonly hiddenComplexity: {
        readonly depth: 'low' | 'medium' | 'high';
        readonly leverage: string;
        readonly locality: string;
    };
    readonly dependencyClass: readonly DeepModuleDependencyClass[];
    readonly replaceDontLayerTest: string;
    readonly rollback: string;
    readonly causalValidators: readonly string[];
    readonly confidence: 'low' | 'medium' | 'high';
    readonly receiptFingerprint: string;
}
export declare const deepModuleProviderInfo: {
    readonly providerId: "matt-pocock-deep-module-reference";
    readonly providerVersion: "2026-07-24.ed37663";
    readonly providerContract: "atm.deepModuleRefactorProvider.v1";
    readonly upstreamUrl: "https://github.com/mattpocock/skills";
    readonly upstreamCommit: "ed37663cc5fbef691ddfecd080dff42f7e7e350d";
    readonly codebaseDesignDigest: "sha256:c46b49303a81c7fc8934d0f4fbc44382cdecb73942d85d8d7db3523407fff8fa";
    readonly improveArchitectureDigest: "sha256:d3682058df92c259b47c36503baa02345d5811758621b5dc03081d5ba0f7b69b";
    readonly license: "MIT";
};
export declare function createDeepModuleReviewReport(input: DeepModuleReviewProviderInput): DeepModuleReviewReport;
export declare function createDeepModuleReviewFingerprint(report: Omit<DeepModuleReviewReport, 'receiptFingerprint'>): string;
export declare function deepModuleProviderVocabulary(): readonly string[];
