export declare function readBranchRef(repo: string): string;
export declare function writeBranchCommitQueueLock(repo: string, input: {
    actorId: string;
    taskId?: string | null;
    branchRef?: string | null;
    headShaAtAcquire?: string | null;
}): void;
