import type { SemanticReadObservation, SemanticRevalidationRequest, SemanticRevalidationResult, SemanticWriteFact } from '../semantic-contract.js';
export declare function adjudicateSemanticRevalidation(request: SemanticRevalidationRequest): SemanticRevalidationResult;
export declare function findStaleReadAnchors(readSet: readonly SemanticReadObservation[], publishedWriteSet: readonly SemanticWriteFact[]): readonly string[];
export declare function canComposeOperations(left: SemanticWriteFact, right: SemanticWriteFact): boolean;
