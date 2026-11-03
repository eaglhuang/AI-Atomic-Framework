export declare const VALID_DECOMPOSITION_DECISIONS: string[];
interface BehaviorInput {
    behaviorId?: string;
    targetKind?: string;
    decompositionDecision?: string;
}
export declare function deriveDecompositionDecision({ behaviorId, targetKind }: BehaviorInput): string;
export declare function resolveReviewTemplate(decompositionDecision: string): string;
export declare function validateDecisionBehaviorPair({ behaviorId, decompositionDecision }: BehaviorInput): void;
export {};
