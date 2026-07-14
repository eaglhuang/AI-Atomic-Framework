export type PromptScopedQueueCommandInput = {
    readonly queueHeadTaskPresent: boolean;
    readonly queuePrompt: string;
    readonly planningCardImportCommand?: string | null;
};
export declare function buildPromptScopedQueueClaimCommand(input: PromptScopedQueueCommandInput): string;
export declare function quotePromptForCli(value: string): string;
