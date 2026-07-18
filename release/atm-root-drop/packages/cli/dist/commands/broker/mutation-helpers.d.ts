import type { BrokerMutationEvidenceEntry, MutationRequest, ConflictKey, ExplicitMutationIntentInputSummary, MutationIntentMissingInput } from '../../../../core/src/broker/types.ts';
export declare function classifyExplicitMutationRequest(request: MutationRequest): {
    readonly explicitInputs: readonly ExplicitMutationIntentInputSummary[];
    readonly missingInputs: readonly MutationIntentMissingInput[];
};
export declare function buildMutationEvidence(adapterId: string, request: MutationRequest, baseHash: string, resultHash: string, mergeDecision: BrokerMutationEvidenceEntry['mergeDecision'], verdict: BrokerMutationEvidenceEntry['verdict'], conflictKeys: readonly ConflictKey[]): BrokerMutationEvidenceEntry;
export declare function extractMutationRequestTransactionIds(request: MutationRequest): readonly string[];
