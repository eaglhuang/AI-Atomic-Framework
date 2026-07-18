export declare function buildTaskDeliveryPrinciple(input: {
    readonly channel: 'normal' | 'batch';
    readonly taskId?: string;
}): {
    schemaId: string;
    taskId: string | null;
    channel: "batch" | "normal";
    principle: string;
    instruction: string;
    doneMeans: string;
    notAllowedAsCompletion: string[];
    nextStep: string;
};
type BatchPlaybookState = 'queue-preview' | 'queue-head-active' | 'repair-required';
export declare function buildChannelPlaybook(input: {
    readonly channel: GovernanceChannel;
    readonly taskId?: string | null;
    readonly originalPrompt?: string | null;
    readonly queueHeadTaskId?: string | null;
    readonly actorPlaceholder?: string;
    readonly batchId?: string | null;
    readonly batchState?: BatchPlaybookState;
    readonly fastClaimCommand?: string | null;
    readonly fastClaimLabel?: string | null;
}): {
    schemaId: string;
    channel: string;
    title: string;
    mustFollow: boolean;
    summary: string;
    steps: string[];
    doNot: string[];
    commandSequence: string[];
    commitTiming: string;
    governedGitEntrypoint: {
        preferredCommand: string;
        directGitPolicy: string;
        fallbackFields?: undefined;
    };
    state?: undefined;
    checkpointCommand?: undefined;
    repairCommand?: undefined;
    closePreview?: undefined;
} | {
    schemaId: string;
    channel: string;
    title: string;
    mustFollow: boolean;
    summary: string;
    state: BatchPlaybookState;
    steps: string[];
    doNot: string[];
    commandSequence: string[];
    commitTiming: string;
    checkpointCommand: string;
    repairCommand: string;
    governedGitEntrypoint: {
        preferredCommand: string;
        directGitPolicy: string;
        fallbackFields?: undefined;
    };
    closePreview?: undefined;
} | {
    schemaId: string;
    channel: string;
    title: string;
    mustFollow: boolean;
    summary: string;
    steps: string[];
    doNot: string[];
    commandSequence: string[];
    closePreview: {
        schemaId: string;
        preCloseCommand: string;
        dryRunCommand: string;
        writeCommand: string;
        hintField: string;
    };
    commitTiming: string;
    governedGitEntrypoint: {
        preferredCommand: string;
        directGitPolicy: string;
        fallbackFields: string[];
    };
    state?: undefined;
    checkpointCommand?: undefined;
    repairCommand?: undefined;
};
export {};
