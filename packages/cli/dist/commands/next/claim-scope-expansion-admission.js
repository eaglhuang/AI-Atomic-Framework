import { CliError, quoteCliValue } from '../shared.js';
/**
 * Claiming a task cannot silently absorb tracked deliverable files.  The
 * claimed scope must explicitly grow first, so the subsequent direction lock
 * and admission ticket describe the same writable surface.
 */
export function assertClaimScopeExpansionAdmission(input) {
    const requiredFiles = input.scopeDiagnostic.scopeExpansionRequiredFiles;
    if (requiredFiles.length === 0)
        return;
    throw new CliError('ATM_TASK_SCOPE_EXPANSION_REQUIRED', `Task ${input.taskId} has tracked deliverable-like files outside its allowed scope. Expand the task scope before claiming.`, {
        exitCode: 1,
        details: {
            taskId: input.taskId,
            actorId: input.actorId,
            scopeExpansionRequiredFiles: requiredFiles,
            allowedFiles: input.allowedFiles,
            requiredCommand: `node atm.mjs tasks scope add --task ${input.taskId} --actor ${quoteCliValue(input.actorId)} --add ${quoteCliValue(requiredFiles.join(','))} --json`,
            scopeDiagnostic: input.scopeDiagnostic
        }
    });
}
