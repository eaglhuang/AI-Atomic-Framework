import { writeImportEvidence, writeTaskFiles as writeTaskFilesLegacy } from './legacy-impl.ts';
export type { TaskImportRecord, TaskImportDiagnostic } from './legacy-impl.ts';
type WriteTaskFilesInput = Parameters<typeof writeTaskFilesLegacy>[0];
type WriteTaskFilesResult = ReturnType<typeof writeTaskFilesLegacy>;
export declare function writeTaskFiles(input: WriteTaskFilesInput): WriteTaskFilesResult;
export { writeImportEvidence };
