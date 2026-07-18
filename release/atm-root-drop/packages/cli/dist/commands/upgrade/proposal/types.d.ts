export interface UpgradeCommandOptions {
    cwd: string;
    propose: boolean;
    scan: boolean;
    dryRun: boolean;
    atomId: string | null;
    fromVersion: string | null;
    toVersion: string | null;
    behaviorId: string;
    decompositionDecision: string | null;
    inputPaths: string[];
    target: {
        kind: 'atom' | 'map';
        mapId?: string;
    };
    fork: {
        sourceAtomId?: string;
        newAtomId?: string;
    } | null;
    mapImpactScope: {
        affectedMapIds?: string[];
        propagationStatus?: unknown[];
    } | null;
    legacyTarget: string | null;
    guidanceSession: string | null;
    requestedReplacementMode: string | null;
    equivalenceReport: string | null;
    polymorphImpactReport: string | null;
    propagationReport: string | null;
    reviewAdvisory: string | null;
    humanReview: string | null;
    rollbackProof: string | null;
    retirementProof: string | null;
    proposalId: string | null;
    proposedBy: string;
    proposedAt: string | null;
    migration: Record<string, unknown> | null;
}
export type ParsedUpgradeCommandOptions = Omit<UpgradeCommandOptions, 'proposedAt'> & {
    proposedAt: string;
};
