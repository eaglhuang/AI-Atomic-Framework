interface UpgradeMapProposeOptions {
    cwd: string;
    atomId?: string | null;
    fromVersion?: string | null;
    toVersion?: string | null;
    behaviorId?: string | null;
    decompositionDecision?: string | null;
    target: {
        mapId: string;
    };
    fork?: {
        sourceAtomId: string;
        newAtomId: string;
    } | null;
    mapImpactScope?: string | null;
    proposalId?: string | null;
    proposedBy?: string | null;
    proposedAt?: string | null;
    migration?: {
        strategy: string;
        fromVersion?: string | null;
        notes?: string;
    } | null;
    requestedReplacementMode?: string | null;
    contextBudgetGate?: object | null;
    inputs?: Array<{
        kind: string;
        path: string;
        document: Record<string, unknown>;
    }> | null;
    equivalenceReport?: string | null;
    polymorphImpactReport?: string | null;
    propagationReport?: string | null;
    reviewAdvisory?: string | null;
    humanReview?: string | null;
    rollbackProof?: string | null;
    retirementProof?: string | null;
}
export declare function runUpgradeMapPropose(options: UpgradeMapProposeOptions): Record<string, unknown>;
export {};
