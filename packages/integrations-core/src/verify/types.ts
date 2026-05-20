/**
 * verify/types.ts
 *
 * TASK-ASR-0013 — integrations-core complete split
 *
 * IntegrationFinding type aliases and verify/uninstall result interfaces.
 * No dependencies on other integrations-core submodules (standalone).
 */

export type IntegrationFindingLevel = 'info' | 'warning' | 'error';
export type IntegrationFindingCode = 'file-ok' | 'file-missing' | 'hash-mismatch' | 'manifest-preserved' | 'manifest-removed';

export interface IntegrationFinding {
  readonly level: IntegrationFindingLevel;
  readonly code: IntegrationFindingCode;
  readonly path: string;
  readonly message: string;
}

export interface IntegrationVerifyResult {
  readonly ok: boolean;
  readonly adapterId: string;
  readonly findings: readonly IntegrationFinding[];
  readonly driftedFiles: readonly string[];
}

export interface IntegrationUninstallResult {
  readonly ok: boolean;
  readonly adapterId: string;
  readonly removedFiles: readonly string[];
  readonly preservedFiles: readonly string[];
  readonly findings: readonly IntegrationFinding[];
}
