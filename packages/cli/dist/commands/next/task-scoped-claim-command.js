import { sealPasteCommand } from '../shared/paste-command.js';
import { quoteCliToken, quoteCliValue } from './view-projections.js';
/**
 * Pure contract builder for TASK-CID-0073 task-scoped claim command fields.
 * Returns null when no selected task id is available.
 */
export function buildTaskScopedClaimCommand(input) {
    if (!input.selectedTaskId || input.selectedTaskId.trim().length === 0) {
        return null;
    }
    const selectedTaskId = input.selectedTaskId.trim();
    const promptValue = input.userPrompt?.trim() || selectedTaskId;
    const explicitTaskSelector = input.explicitTaskSelector?.trim() || null;
    const suppliedActor = input.actorId?.trim() ?? '';
    const actor = suppliedActor && !/<[^>\r\n]+>/.test(suppliedActor) ? quoteCliToken(suppliedActor) : '<id>';
    const taskScoped = sealPasteCommand(`node atm.mjs next --claim --actor ${actor} --task ${selectedTaskId} --auto-intent --json`);
    const normal = sealPasteCommand(explicitTaskSelector
        ? `node atm.mjs next --claim --actor ${actor} --task ${explicitTaskSelector} --auto-intent --json`
        : `node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(promptValue)} --auto-intent --json`);
    const missing = [...new Set([...normal.missing, ...taskScoped.missing])].sort();
    const pasteReady = normal.ready && taskScoped.ready;
    return {
        schemaId: 'atm.nextTaskScopedClaimCommand.v1',
        normalClaimCommand: (normal.ready ? normal.command : normal.commandTemplate) ?? '',
        taskScopedClaimCommand: (taskScoped.ready ? taskScoped.command : taskScoped.commandTemplate) ?? '',
        claimCommandShape: explicitTaskSelector ? 'task-scoped' : 'prompt-scoped',
        explicitTaskSelector,
        pasteReady,
        missing,
        ...(pasteReady ? {} : { commandTemplate: normal.commandTemplate ?? taskScoped.commandTemplate })
    };
}
