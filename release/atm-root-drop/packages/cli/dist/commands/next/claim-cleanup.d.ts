import type { TaskQueueRecord } from '../task-direction.ts';
export declare function cleanupPreviousBatchQueueLocks(input: {
    readonly cwd: string;
    readonly actorId: string;
    readonly queue: TaskQueueRecord;
}): Promise<void>;
