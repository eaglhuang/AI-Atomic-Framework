import { sealPasteCommand } from '../shared/paste-command.ts';

export type PromptScopedQueueCommandInput = {
  readonly queueHeadTaskPresent: boolean;
  readonly queuePrompt: string;
  readonly planningCardImportCommand?: string | null;
  readonly actorId?: string | null;
};

export function buildPromptScopedQueueClaimCommand(input: PromptScopedQueueCommandInput): string {
  if (input.planningCardImportCommand && input.planningCardImportCommand.trim().length > 0) {
    return input.planningCardImportCommand;
  }
  if (!input.queueHeadTaskPresent) {
    return sealPasteCommand('node atm.mjs next --prompt "<current user prompt>" --json').commandTemplate
      ?? 'node atm.mjs next --prompt "ATM_USER_PROMPT" --json';
  }
  const actor = input.actorId?.trim() && !/<[^>\r\n]+>/.test(input.actorId) ? input.actorId.trim() : '<id>';
  const sealed = sealPasteCommand(`node atm.mjs next --claim --actor ${actor} --prompt ${quotePromptForCli(input.queuePrompt)} --auto-intent --json`);
  return (sealed.ready ? sealed.command : sealed.commandTemplate) ?? '';
}

export function quotePromptForCli(value: string): string {
  return JSON.stringify(value);
}
