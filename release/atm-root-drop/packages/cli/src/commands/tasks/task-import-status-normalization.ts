import type {
  TaskCardImportDiagnostic,
  TaskImportRecord
} from './result-contracts.ts';

function normalizeTaskStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}

export function normalizeImportedTaskForTargetLedger(task: TaskImportRecord): TaskImportRecord {
  if (normalizeTaskStatus(task.status) !== 'in_progress') return task;
  const diagnostic: TaskCardImportDiagnostic = {
    severity: 'info',
    code: 'ATM_TASK_IMPORT_PLANNING_IN_PROGRESS_CLAIMABLE',
    message: `Task ${task.workItemId} declared planning status in-progress; imported target ledger status as ready so an agent can claim it through next --claim.`
  };
  return {
    ...task,
    status: 'ready',
    importDiagnostics: [...(task.importDiagnostics ?? []), diagnostic]
  };
}

export function normalizeImportedTasksForTargetLedger(tasks: readonly TaskImportRecord[]): readonly TaskImportRecord[] {
  return tasks.map(normalizeImportedTaskForTargetLedger);
}
