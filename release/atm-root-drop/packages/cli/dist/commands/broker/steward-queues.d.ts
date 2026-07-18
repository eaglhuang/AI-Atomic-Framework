import { type RunnerSyncStewardQueueDocument } from '../../../../core/src/broker/runner-sync-steward-queue.ts';
import type { BrokerCommandContext } from './types.ts';
import type { ParsedBrokerOptions } from './parser.ts';
export declare function handleBrokerStewardQueues(options: ParsedBrokerOptions, context: BrokerCommandContext): import("../shared.ts").CommandResult | null;
export declare function validateRunnerSyncReleaseReceipt(input: {
    cwd: string;
    queue: RunnerSyncStewardQueueDocument;
    taskId: string;
    stewardWorkId: string;
    receiptRef: string | null;
    receiptDigest: string | null;
}): {
    receiptRef: string;
    receiptDigest: string;
};
