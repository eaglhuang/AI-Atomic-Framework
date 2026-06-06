export type ReshapeMode = 'split' | 'merge';
export interface SplitSpec {
    sourceAtomId: string;
    newAtomIds: [string, string];
    newAtomNames: [string, string];
    edgeRerouting: EdgeRerouteEntry[];
}
export interface MergeSpec {
    sourceAtomIds: [string, string];
    newAtomId: string;
    newAtomName: string;
    edgeRerouting: EdgeRerouteEntry[];
}
export interface EdgeRerouteEntry {
    originalFrom: string;
    originalTo: string;
    newFrom: string;
    newTo: string;
    binding: string;
    reason: string;
}
export interface ReshapeProposal {
    schemaId: 'atm.reshapeProposal';
    proposalId: string;
    mapId: string;
    mode: ReshapeMode;
    proposedAt: string;
    proposedBy: string;
    split?: SplitSpec;
    merge?: MergeSpec;
    dryRun: boolean;
    externalBindingSchemaHash: string;
    status: 'pending-human-review' | 'approved' | 'rejected' | 'applied';
    humanReviewDecisionId?: string;
    appliedAt?: string;
}
export interface ReshapeDryRunResult {
    ok: boolean;
    proposal: ReshapeProposal;
    warnings: string[];
    plan: {
        atomsToDeprecate: string[];
        atomsToCreate: string[];
        edgesRerouted: EdgeRerouteEntry[];
        externalBindingSchemaHash: string;
        externalBindingUnchanged: boolean;
    };
}
export interface ReshapeApplyResult {
    ok: boolean;
    proposal: ReshapeProposal;
    appliedAt: string;
    atomsDeprecated: string[];
    atomsCreated: string[];
    lineageEvent: LineageEvent;
}
export interface LineageEvent {
    eventType: 'reshape';
    mapId: string;
    mode: ReshapeMode;
    timestamp: string;
    sourceAtoms: string[];
    resultAtoms: string[];
    proposalId: string;
}
export declare function dryRunReshape(repositoryRoot: string, mapId: string, mode: ReshapeMode, spec: SplitSpec | MergeSpec, proposedBy?: string): ReshapeDryRunResult;
export declare function applyReshape(repositoryRoot: string, proposal: ReshapeProposal, humanReviewDecisionId: string): ReshapeApplyResult;
