// TASK-SKL-0029 — precise missing contract/case/group recovery on import.
//
// Extracted from task-import-validators.ts so the recovery manifest builder does
// not force further growth on an already oversized module (INV-ATM-009,
// extraction-first). When the validation contract is unavailable or incomplete,
// import must expose the exact missing contract/case/group fields and fail
// closed with one executable recovery manifest — never import a card that cannot
// be selected against and never silently default to a full-repository suite.
import type { CausalValidatorImportValidation } from './task-import-validators.ts';

export interface ContractImportRecoveryField {
  readonly code: string;
  readonly field: string;
  readonly detail: string;
}

export interface ContractImportRecoveryManifest {
  readonly ok: boolean;
  readonly failClosed: boolean;
  readonly missing: readonly ContractImportRecoveryField[];
  readonly recoveryCommand: string | null;
}

export function buildContractImportRecoveryManifest(input: {
  readonly validation: CausalValidatorImportValidation;
  readonly taskId: string;
  readonly planPath?: string | null;
}): ContractImportRecoveryManifest {
  const missing = input.validation.diagnostics
    .filter((entry) => entry.severity === 'error')
    .map((entry) => ({
      code: entry.code,
      field: entry.field ?? 'validators',
      detail: entry.message
    }));
  if (missing.length === 0) {
    return { ok: true, failClosed: false, missing: [], recoveryCommand: null };
  }
  const planRef = input.planPath && input.planPath.trim() ? input.planPath.trim() : '<plan-markdown-path>';
  const fields = [...new Set(missing.map((entry) => entry.field))].sort((a, b) => a.localeCompare(b));
  const recoveryCommand =
    `Add resolvable ${fields.join(', ')} to ${input.taskId}, then re-validate with `
    + `node atm.mjs tasks import --from ${planRef} --dry-run --json`;
  return { ok: false, failClosed: true, missing, recoveryCommand };
}
