export type PromptScopedQueueCommandInput = {
  readonly queueHeadTaskPresent: boolean;
  readonly queuePrompt: string;
  readonly planningCardImportCommand?: string | null;
};

export function buildPromptScopedQueueClaimCommand(input: PromptScopedQueueCommandInput): string {
  if (input.planningCardImportCommand && input.planningCardImportCommand.trim().length > 0) {
    return input.planningCardImportCommand;
  }
  if (!input.queueHeadTaskPresent) {
    return 'node atm.mjs next --prompt "<current user prompt>" --json';
  }
  return `node atm.mjs next --claim --actor <id> --prompt ${quotePromptForCli(input.queuePrompt)} --auto-intent --json`;
}

export function quotePromptForCli(value: string): string {
  return JSON.stringify(value);
}
