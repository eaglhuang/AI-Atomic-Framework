import { parsePlanMarkdown as parseLegacyPlanMarkdown } from './legacy/implementation.js';
import { isCanonicalTaskIdDeclaration } from './canonical-task-id-boundary.js';
export function parsePlanMarkdown(input) {
    const parsed = parseLegacyPlanMarkdown(input);
    const diagnostics = [...parsed.diagnostics];
    const tasks = parsed.tasks.filter((task) => {
        if (isCanonicalTaskIdDeclaration(task.workItemId)) {
            return true;
        }
        diagnostics.push({
            level: 'warning',
            code: 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT',
            text: `Ignored non-canonical task id fragment ${task.workItemId}; plan import declarations require a complete task id with a 4-5 digit numeric suffix and a right boundary.`,
            workItemId: task.workItemId,
            sourceLine: task.source.headingLine
        });
        return false;
    });
    return { tasks, diagnostics };
}
