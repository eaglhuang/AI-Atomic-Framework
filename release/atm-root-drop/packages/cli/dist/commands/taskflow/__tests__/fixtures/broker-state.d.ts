export declare function makeActiveIntent(input: {
    taskId: string;
    actorId: string;
    files: string[];
    atomIds?: string[];
    atomCids?: string[];
    expiresAt?: string;
    leaseEpoch?: number;
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
export declare function writeBrokerRegistry(repo: string, activeIntents: unknown[], options?: {
    currentEpoch?: number;
}): void;
