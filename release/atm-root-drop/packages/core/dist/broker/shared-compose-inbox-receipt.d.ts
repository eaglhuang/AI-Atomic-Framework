import { type ProposalStage, type ProposalTerminal, type StopReason, type SubmitSharedComposeInput } from './shared-compose-inbox-contract.js';
import { type ComposeBatchRecord, type SharedComposeReceipt, type StoredComposeProposal } from './shared-compose-inbox-fs.js';
export declare function settleTerminal(args: {
    readonly renameAt: number | null;
    readonly ackAt: number | null;
    readonly effectiveStop: number;
    readonly intended: ProposalTerminal;
    readonly intendedReason: StopReason;
    readonly resultHash: string | null;
    readonly observedHash: string | null;
}): {
    readonly terminal: ProposalTerminal;
    readonly stopReason: StopReason;
};
export declare function receiptFrom(proposal: StoredComposeProposal, batch: ComposeBatchRecord, fields: {
    readonly stage: ProposalStage;
    readonly stagesReached: ProposalStage[];
    readonly terminal: ProposalTerminal;
    readonly resolvedTerminal: ProposalTerminal | null;
    readonly resolvedStopReason: StopReason | null;
    readonly stopReason: StopReason;
    readonly detail: string | null;
    readonly ackAt: number | null;
    readonly elapsedMs: number;
    readonly renamed: boolean;
    readonly now: () => number;
}): SharedComposeReceipt;
export declare function ensureProposal(input: SubmitSharedComposeInput, nowMs: number): StoredComposeProposal;
export declare function rejectAdmission(input: SubmitSharedComposeInput, proposal: StoredComposeProposal): SharedComposeReceipt;
export declare function finishTimeout(input: SubmitSharedComposeInput, proposal: StoredComposeProposal, nowMs: number): SharedComposeReceipt;
export declare function retryExhausted(input: SubmitSharedComposeInput, nowMs: number): SharedComposeReceipt;
export declare function consumeRetry(input: SubmitSharedComposeInput, nowMs: number): boolean;
export declare function finishError(input: SubmitSharedComposeInput, error: unknown, nowMs: number): SharedComposeReceipt;
export declare function effectiveStopAt(proposal: StoredComposeProposal): number;
export declare function proposalClockStopReason(proposal: StoredComposeProposal, nowMs: number): StopReason;
export declare function diagnosticVerdict(members: readonly StoredComposeProposal[]): string | null;
export declare function mustProposal(input: SubmitSharedComposeInput): StoredComposeProposal;
