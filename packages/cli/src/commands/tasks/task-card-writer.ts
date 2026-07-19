import {
  writeImportEvidence,
  writeTaskFiles as writeTaskFilesLegacy
} from './legacy-impl.ts';
import { normalizeImportedTasksForTargetLedger } from './task-import-status-normalization.ts';

export type {
  TaskImportRecord,
  TaskImportDiagnostic
} from './legacy-impl.ts';

type WriteTaskFilesInput = Parameters<typeof writeTaskFilesLegacy>[0];
type WriteTaskFilesResult = ReturnType<typeof writeTaskFilesLegacy>;

export function writeTaskFiles(input: WriteTaskFilesInput): WriteTaskFilesResult {
  return writeTaskFilesLegacy({
    ...input,
    tasks: normalizeImportedTasksForTargetLedger(input.tasks)
  });
}

export { writeImportEvidence };
