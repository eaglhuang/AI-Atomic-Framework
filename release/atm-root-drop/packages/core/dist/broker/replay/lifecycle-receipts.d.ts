import { type ComposeDisposition, type LifecycleReceiptValidation, type ParallelReplayLifecycleStep, type PostComposeValidationEvidence, type SameFileIntentEvidence, type SemanticLifecycleReceipt } from './lifecycle-receipt-types.js';
export * from './lifecycle-receipt-types.js';
export * from './lifecycle-receipt-observability.js';
export { finishValidation } from './lifecycle-receipt-validation.js';
export declare function isParallelReplayLifecycleStep(value: unknown): value is ParallelReplayLifecycleStep;
export declare function buildSemanticLifecycleReceipt(input: Omit<SemanticLifecycleReceipt, 'schemaId' | 'digest'> & {
    readonly digest?: string;
}): SemanticLifecycleReceipt;
export declare function validateSemanticLifecycleReceipt(receipt: unknown, expected?: {
    readonly step?: ParallelReplayLifecycleStep;
    readonly taskId?: string;
    readonly actorId?: string;
    readonly ticketGeneration?: string | null;
    readonly sharedSurface?: string | null;
}): LifecycleReceiptValidation;
export declare function deriveAdmissionFromCanonicalTicket(input: {
    readonly canonicalTicketState: string | null | undefined;
    readonly callerRequestedParallel?: boolean;
    readonly intersectionNonEmpty?: boolean;
}): {
    readonly admission: 'parallel' | 'serialized' | 'not-required' | 'invalid' | 'missing';
    readonly reason: string;
    readonly invariantCodes: readonly ('INV-ATM-008')[];
};
export declare function validateSameFileIntentEvidence(evidence: SameFileIntentEvidence): LifecycleReceiptValidation;
export declare function validatePostComposeSemanticEvidence(evidence: PostComposeValidationEvidence): LifecycleReceiptValidation;
export declare function evaluateComposeQueueResidency(input: {
    readonly disposition: ComposeDisposition;
    readonly waitedMs: number;
    readonly hasCanonicalQueueTransitionEvent: boolean;
}): LifecycleReceiptValidation;
