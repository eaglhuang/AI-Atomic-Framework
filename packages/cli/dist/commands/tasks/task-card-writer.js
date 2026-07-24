import { writeImportEvidence, writeTaskFiles as writeTaskFilesLegacy } from './legacy-impl.js';
import { normalizeImportedTasksForTargetLedger } from './task-import-status-normalization.js';
import { normalizeTaskCausalGraphContract } from './task-import-validators.js';
export function writeTaskFiles(input) {
    return writeTaskFilesLegacy({
        ...input,
        tasks: normalizeImportedTasksForTargetLedger(input.tasks).map((task) => ({
            ...task,
            causalGraph: normalizeTaskCausalGraphContract(task.causalGraph)
        }))
    });
}
export { writeImportEvidence };
