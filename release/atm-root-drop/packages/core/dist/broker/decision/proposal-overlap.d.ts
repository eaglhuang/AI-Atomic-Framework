import type { ActiveWriteIntent, BrokerConflictMatrix, BrokerDecision, ProposalAdmissionBoundedRegion, ProposalAdmissionEvidence, WriteIntent } from '../types.ts';
export declare function evaluateProposalOverlap(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[], baseAdmission: ProposalAdmissionEvidence, conflictMatrix: BrokerConflictMatrix): BrokerDecision | null;
export declare function resolveProposalRegionsForFile(intent: WriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[];
export declare function resolveActiveProposalRegionsForFile(intent: ActiveWriteIntent, filePath: string): readonly ProposalAdmissionBoundedRegion[];
export declare function findOverlappingProposalRegion(left: readonly ProposalAdmissionBoundedRegion[], right: readonly ProposalAdmissionBoundedRegion[]): ProposalAdmissionBoundedRegion | null;
export declare function shouldRefineProposalScopedCidConflict(newIntent: WriteIntent, activeIntent: ActiveWriteIntent, baseAdmission: ProposalAdmissionEvidence): boolean;
