export function buildPromptScopedQueueClaimCommand(input) {
    if (input.planningCardImportCommand && input.planningCardImportCommand.trim().length > 0) {
        return input.planningCardImportCommand;
    }
    if (!input.queueHeadTaskPresent) {
        return 'node atm.mjs next --prompt "<current user prompt>" --json';
    }
    return `node atm.mjs next --claim --actor <id> --prompt ${quotePromptForCli(input.queuePrompt)} --auto-intent --json`;
}
export function quotePromptForCli(value) {
    return JSON.stringify(value);
}
