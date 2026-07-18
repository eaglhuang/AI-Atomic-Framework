import type { ProposalAdmissionBoundedRegion, ProposalAdmissionEvidence, ProposalAdmissionRequest, ProposalAdmissionState, WriteIntent } from '../types.ts';
export declare function buildProposalAdmissionBase(intent: WriteIntent): ProposalAdmissionEvidence;
export declare function finalizeProposalAdmission(base: ProposalAdmissionEvidence, preferredState: ProposalAdmissionState, overrides: {
    readonly reason: string;
    readonly rearbitrationRequired?: boolean;
}): ProposalAdmissionEvidence;
export declare function defaultProposalAdmissionRequest(): ProposalAdmissionRequest;
export declare function normalizeStringList(values: readonly string[]): readonly string[];
export declare function normalizeBoundedRegions(values: readonly ProposalAdmissionBoundedRegion[]): readonly ProposalAdmissionBoundedRegion[];
