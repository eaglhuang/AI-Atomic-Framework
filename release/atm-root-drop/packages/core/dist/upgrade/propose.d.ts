interface ProposalRequest {
    inputs: object[];
    atomId?: string | null;
    fromVersion?: string | null;
    toVersion?: string | null;
    behaviorId?: string | null;
    decompositionDecision?: string | null;
    target?: {
        kind?: string;
        mapId?: string;
    } | null;
    fork?: {
        sourceAtomId?: string;
        newAtomId?: string;
    } | null;
    mapImpactScope?: {
        affectedMapIds?: string[];
        propagationStatus?: unknown[];
    } | null;
    proposedBy?: string;
    proposedAt?: string;
    proposalId?: string | null;
    migration?: {
        strategy?: string;
        fromVersion?: string | null;
        notes?: string;
    } | null;
    requestedReplacementMode?: string | null;
    repositoryRoot?: string;
    contextBudgetGate?: object | null;
}
export declare function proposeAtomicUpgrade(request: ProposalRequest): Record<string, unknown>;
export {};
