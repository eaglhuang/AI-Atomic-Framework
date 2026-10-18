import { SHARED_COMPOSE_CONTRACT, type RecoverSharedComposeInput, type RecoverSharedComposeResult, type SubmitSharedComposeInput } from './shared-compose-inbox-contract.js';
import { type SharedComposeReceipt, hashComposeBytes } from './shared-compose-inbox-fs.js';
export type { ProposalStage, ProposalTerminal, RecoverSharedComposeInput, RecoverSharedComposeResult, SharedComposeAdmissionInput, StopReason, SubmitSharedComposeInput } from './shared-compose-inbox-contract.js';
export type { SharedComposeReceipt } from './shared-compose-inbox-fs.js';
export { hashComposeBytes, SHARED_COMPOSE_CONTRACT };
export declare function submitSharedComposeProposal(input: SubmitSharedComposeInput): Promise<SharedComposeReceipt>;
export declare function recoverSharedComposeInbox(input: RecoverSharedComposeInput): RecoverSharedComposeResult;
export declare function registerSharedComposeEntryPoint(inboxDir: string, entryPointId: string, pid?: number): void;
export declare function stopSharedComposeEntryPoint(inboxDir: string, entryPointId: string, stoppedAt?: number): void;
export declare function reconcileSharedComposeProposal(input: {
    readonly inboxDir: string;
    readonly proposalId: string;
    readonly now?: () => number;
}): SharedComposeReceipt;
