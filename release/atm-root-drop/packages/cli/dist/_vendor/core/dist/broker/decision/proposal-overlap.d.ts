import type { ActiveWriteIntent, BrokerConflictMatrix, BrokerDecision, ProposalAdmissionEvidence, WriteIntent } from '../types.js';
export { findOverlappingProposalRegion, resolveActiveProposalRegionsForFile, resolveProposalRegionsForFile } from './proposal-regions.js';
export declare function evaluateProposalOverlap(newIntent: WriteIntent, activeIntents: readonly ActiveWriteIntent[], baseAdmission: ProposalAdmissionEvidence, conflictMatrix: BrokerConflictMatrix): BrokerDecision | null;
export declare function shouldRefineProposalScopedCidConflict(newIntent: WriteIntent, activeIntent: ActiveWriteIntent, baseAdmission: ProposalAdmissionEvidence): boolean;
