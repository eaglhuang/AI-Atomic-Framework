import { writeImportEvidence, writeTaskFiles as writeTaskFilesLegacy } from './legacy-impl.js';
import { normalizeImportedTasksForTargetLedger } from './task-import-status-normalization.js';
export function writeTaskFiles(input) {
    return writeTaskFilesLegacy({
        ...input,
        tasks: normalizeImportedTasksForTargetLedger(input.tasks)
    });
}
export { writeImportEvidence };
