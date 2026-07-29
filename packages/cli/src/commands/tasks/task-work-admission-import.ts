import {
  issueWorkAdmissionTicket,
  type WorkAdmissionRecoveryMode,
  type WorkAdmissionTicket
} from '../../../../core/src/broker/work-admission-ticket.ts';
import type { TaskCardImportDiagnostic } from './result-contracts.ts';

export interface ImportedWorkAdmissionPolicy {
  readonly recoveryMode: WorkAdmissionRecoveryMode;
}

export interface WorkAdmissionImportValidation {
  readonly policy: ImportedWorkAdmissionPolicy;
  readonly diagnostics: readonly TaskCardImportDiagnostic[];
}

/**
 * Import gets a deliberately tiny ticket: one imported ledger and its matching
 * transition. A later task claim replaces it with the normal write ticket.
 */
export function issueTaskImportAdmissionTicket(input: {
  readonly taskId: string;
  readonly ledgerPath: string;
  readonly transitionPath: string;
  readonly importedAt: string;
  readonly sourceDigest: string;
}): WorkAdmissionTicket {
  return issueWorkAdmissionTicket({
    taskId: input.taskId,
    origin: 'task-import',
    actorId: 'atm-import',
    laneSessionId: null,
    claimGeneration: input.sourceDigest,
    allowedFiles: [input.ledgerPath, input.transitionPath],
    requestedRecoveryMode: 'disabled',
    runnerSelection: {
      runnerKind: 'frozen',
      runnerRef: 'tasks-import',
      selectedAt: input.importedAt
    },
    now: input.importedAt
  });
}

/**
 * Keeps the task-card field small and data-shaped. The authority, rather than
 * import, decides whether auto resolves to enabled or disabled for a claim.
 */
export function validateWorkAdmissionImport(frontmatter: Record<string, unknown> | null | undefined): WorkAdmissionImportValidation {
  const value = readRecoveryMode(frontmatter);
  if (value == null || value === '') {
    return { policy: { recoveryMode: 'auto' }, diagnostics: [] };
  }
  if (value === 'auto' || value === 'enabled' || value === 'disabled') {
    return { policy: { recoveryMode: value }, diagnostics: [] };
  }
  return {
    policy: { recoveryMode: 'auto' },
    diagnostics: [{
      code: 'ATM_WORK_ADMISSION_RECOVERY_MODE_INVALID',
      severity: 'error',
      field: 'workAdmission.recoveryMode',
      message: `workAdmission.recoveryMode "${String(value)}" is invalid; expected auto|enabled|disabled.`
    }]
  };
}

function readRecoveryMode(frontmatter: Record<string, unknown> | null | undefined): string | null {
  if (!frontmatter) return null;
  const workAdmission = frontmatter.workAdmission ?? frontmatter.work_admission;
  if (!workAdmission || typeof workAdmission !== 'object' || Array.isArray(workAdmission)) return null;
  const record = workAdmission as Record<string, unknown>;
  const value = record.recoveryMode ?? record.recovery_mode;
  return value == null ? null : String(value).trim().toLowerCase();
}
