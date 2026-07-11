import { quoteCliValue } from './view-projections.ts';

export type ClaimCommandShape = 'task-scoped' | 'prompt-scoped';

export interface TaskScopedClaimCommandContract {
  readonly schemaId: 'atm.nextTaskScopedClaimCommand.v1';
  readonly normalClaimCommand: string;
  readonly taskScopedClaimCommand: string;
  readonly claimCommandShape: ClaimCommandShape;
  readonly explicitTaskSelector: string | null;
}

export interface BuildTaskScopedClaimCommandInput {
  readonly selectedTaskId: string | null;
  readonly explicitTaskSelector: string | null;
  readonly userPrompt: string | null;
}

/**
 * Pure contract builder for TASK-CID-0073 task-scoped claim command fields.
 * Returns null when no selected task id is available.
 */
export function buildTaskScopedClaimCommand(input: BuildTaskScopedClaimCommandInput): TaskScopedClaimCommandContract | null {
  if (!input.selectedTaskId || input.selectedTaskId.trim().length === 0) {
    return null;
  }
  const selectedTaskId = input.selectedTaskId.trim();
  const promptValue = input.userPrompt?.trim() || selectedTaskId;
  const explicitTaskSelector = input.explicitTaskSelector?.trim() || null;
  const taskScopedClaimCommand = `node atm.mjs next --claim --actor <id> --task ${selectedTaskId} --auto-intent --json`;
  const normalClaimCommand = explicitTaskSelector
    ? `node atm.mjs next --claim --actor <id> --task ${explicitTaskSelector} --auto-intent --json`
    : `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(promptValue)} --auto-intent --json`;
  return {
    schemaId: 'atm.nextTaskScopedClaimCommand.v1',
    normalClaimCommand,
    taskScopedClaimCommand,
    claimCommandShape: explicitTaskSelector ? 'task-scoped' : 'prompt-scoped',
    explicitTaskSelector
  };
}
