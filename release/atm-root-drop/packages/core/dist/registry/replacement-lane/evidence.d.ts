import { type EvidenceCheckResult, type LoadedEvidenceDocument } from './types.js';
export declare function loadEvidenceDocuments(repositoryRoot: string, evidenceRefs: readonly string[]): LoadedEvidenceDocument[];
export declare function findMapEquivalenceEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult;
export declare function findPropagationEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult;
export declare function findReviewAdvisoryEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult;
export declare function findHumanReviewEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult;
export declare function findRollbackProofEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult;
export declare function findRetirementProofEvidence(mapId: string, evidenceDocuments: LoadedEvidenceDocument[]): EvidenceCheckResult;
