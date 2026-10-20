import type { ActiveWriteIntent, ProposalAdmissionBoundedRegion, WriteIntent } from '../types.js';
/** Proposal bounds take precedence over coarse atom ownership ranges. */
export declare function resolveProposalRegionsForFile(intent: WriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[];
export declare function resolveActiveProposalRegionsForFile(intent: ActiveWriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[];
export declare function findOverlappingProposalRegion(left: readonly ProposalAdmissionBoundedRegion[], right: readonly ProposalAdmissionBoundedRegion[]): ProposalAdmissionBoundedRegion | null;
