import type { TaskImportRecord } from './result-contracts.ts';
export declare function normalizeImportedTaskForTargetLedger(task: TaskImportRecord): TaskImportRecord;
export declare function normalizeImportedTasksForTargetLedger(tasks: readonly TaskImportRecord[]): readonly TaskImportRecord[];
