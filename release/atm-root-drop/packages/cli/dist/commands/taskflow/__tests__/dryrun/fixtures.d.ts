export declare const rootDir: string;
export declare function makeDualRepoOpenFixture(): Promise<{
    targetRepo: string;
    planningRepo: string;
    profilePath: string;
}>;
export declare function writeText(filePath: string, text: string): void;
export declare function writeJson(filePath: string, value: unknown): void;
export declare function initGitRepo(repo: string): void;
export declare function writeBranchCommitQueueLock(repo: string, input: {
    actorId: string;
    taskId?: string | null;
    branchRef?: string | null;
    headShaAtAcquire?: string | null;
}): void;
export declare function readBranchRef(repo: string): string;
export declare function writeBrokerRegistry(repo: string, activeIntents: unknown[], options?: {
    currentEpoch?: number;
}): void;
export declare function makeActiveIntent(input: {
    taskId: string;
    actorId: string;
    files: string[];
    atomIds?: string[];
    atomCids?: string[];
    expiresAt?: string;
}): {
    intentId: string;
    taskId: string;
    teamRunId: null;
    actorId: string;
    baseCommit: string;
    resourceKeys: {
        files: string[];
        atomIds: string[];
        atomCids: string[];
        generators: never[];
        projections: never[];
        registries: never[];
        validators: never[];
        artifacts: never[];
    };
    leaseEpoch: number;
    leaseSeconds: number;
    leaseMaxSeconds: number;
    heartbeatAt: string;
    lane: string;
    expiresAt: string;
};
export declare function makeBrokerCloseFixture(label: string): Promise<{
    targetRepo: string;
    planningRepo: string;
    taskId: string;
}>;
export declare function makeDualRepoCloseFixture(label: string, options?: {
    closePlanningStatus?: string;
}): Promise<{
    targetRepo: string;
    planningRepo: string;
    taskId: string;
    planPath: string;
    deliveryCommit: string;
    profilePath: string;
}>;
