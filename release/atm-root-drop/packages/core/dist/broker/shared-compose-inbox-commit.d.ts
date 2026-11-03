import { type SubmitSharedComposeInput } from './shared-compose-inbox-contract.js';
import { type ComposeBatchRecord, type SharedComposeReceipt } from './shared-compose-inbox-fs.js';
import { type SubsetSelection } from './shared-compose-inbox-merge.js';
export interface ComposeOutcome {
    readonly selection: SubsetSelection;
    readonly errors: readonly {
        readonly proposalId: string;
        readonly detail: string;
    }[];
    readonly diagnostic: string | null;
}
export interface CommitResult {
    readonly kind: 'ok' | 'requeue';
    readonly receipt: SharedComposeReceipt | null;
}
export declare function composeBatch(inboxDir: string, batch: ComposeBatchRecord): ComposeOutcome;
export declare function commitComposed(input: SubmitSharedComposeInput, batchId: string, outcome: ComposeOutcome, now: () => number): CommitResult;
export declare function resumeCommit(inboxDir: string, batchId: string, now: () => number): string[];
export declare function writeMemberReceipts(input: SubmitSharedComposeInput, batch: ComposeBatchRecord, outcome: ComposeOutcome | null, now: () => number): void;
export declare function bareInput(inboxDir: string, batch: ComposeBatchRecord): SubmitSharedComposeInput;
