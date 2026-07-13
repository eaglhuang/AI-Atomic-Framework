/**
 * TASK-RFT-0010 — tasks.command.result-contracts atom.
 *
 * Result Contract Object owner for the `tasks` command surface. This module
 * centralises the public JSON contract types emitted by `tasks import`,
 * `tasks verify`, the legacy ledger migration, and the deliverable gate.
 *
 * Behaviour is preserved verbatim: the field names, schemaIds, and shapes are
 * a 1:1 copy of what previously lived inline in `packages/cli/src/commands/tasks.ts`.
 * tasks.ts re-exports these symbols so external callers see no surface change.
 *
 * Additive fields are tolerated by callers; renames / removals are NOT.
 */

import type { ContextMap } from './task-import-validators.ts';
import type { TaskDispatchPattern } from './task-markdown-helpers.ts';
import type { TaskHistoricalDeliveryReport } from './historical-delivery.ts';

// ---------------------------------------------------------------------------
// tasks import contracts
// ---------------------------------------------------------------------------

export type TaskImportStatus =
  | 'planned'
  | 'open'
  | 'in_progress'
  | 'reserved'
  | 'ready'
  | 'running'
  | 'review'
  | 'blocked'
  | 'abandoned'
  | 'done';

export interface TaskImportSource {
  readonly planPath: string;
  readonly sectionTitle: string;
  readonly headingLine: number;
  readonly hash: string;
}

export interface TaskCardImportDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly field?: string;
  readonly alias?: string;
  readonly canonical?: string;
  readonly candidates?: readonly string[];
}

export interface TaskImportRecord {
  readonly schemaVersion: 'atm.workItem.v0.2';
  readonly workItemId: string;
  readonly title: string;
  readonly status: TaskImportStatus;
  readonly milestone?: string | null;
  readonly dependencies: readonly string[];
  readonly acceptance: readonly string[];
  readonly deliverables: readonly string[];
  readonly scopePaths?: readonly string[];
  readonly validators?: readonly string[];
  readonly testPlan?: Record<string, unknown>;
  readonly planningRepo?: string | null;
  readonly targetRepo?: string | null;
  readonly closureAuthority?: string | null;
  readonly planningReadOnlyPaths?: readonly string[];
  readonly planningMirrorPaths?: readonly string[];
  readonly outOfScope?: readonly string[];
  readonly nonGoals?: readonly string[];
  readonly evidenceRequired?: string | null;
  readonly rollbackStrategy?: string | null;
  readonly rollbackNotes?: string | null;
  readonly atomizationImpact?: {
    readonly ownerAtomOrMap?: string | null;
    readonly atomCid?: string | null;
    readonly mapUpdates?: readonly string[];
    /** TASK-AAO-FABLE-006/007 — extraction-first contract: atoms this card could extract in passing. */
    readonly extractionCandidates?: readonly {
      readonly atom?: string;
      readonly pattern?: string;
      readonly source?: string;
      readonly disposition?: string;
      readonly inlineReason?: string | null;
    }[];
  };
  readonly proposalAdmission?: {
    readonly trigger: 'not-required' | 'hot-file' | 'same-file-overlap-risk' | 'shared-surface-risk' | 'manual-review-surface';
    readonly summarySubmitted: boolean;
    readonly boundedRegions?: readonly {
      readonly filePath: string;
      readonly lineStart: number;
      readonly lineEnd: number;
    }[];
    readonly hotFiles?: readonly string[];
    readonly notes?: string | null;
  };
  readonly legacyImportAliases?: Record<string, readonly string[] | string>;
  readonly importDiagnostics?: readonly TaskCardImportDiagnostic[];
  readonly tags: readonly string[];
  readonly notes?: string | null;
  readonly contextMap?: ContextMap;
  readonly dispatchPattern?: TaskDispatchPattern;
  readonly conditionReview?: readonly string[];
  readonly mailboxAssignee?: string | null;
  readonly source: TaskImportSource;
  readonly importedAt: string;
}

export interface TaskImportDiagnostic {
  readonly level: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly text: string;
  readonly workItemId?: string;
  readonly sourceLine?: number;
}

export interface TaskImportManifest {
  readonly schemaId: 'atm.taskImportManifest';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly planPath: string;
  readonly mode: 'dry-run' | 'write';
  readonly tasks: readonly TaskImportRecord[];
  readonly diagnostics: readonly TaskImportDiagnostic[];
  readonly writtenPaths: readonly string[];
  readonly evidencePath: string | null;
}

// ---------------------------------------------------------------------------
// tasks verify contract
// ---------------------------------------------------------------------------

export interface TaskVerifyReport {
  readonly schemaId: 'atm.taskVerifyReport';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly taskStorePath: string;
  readonly inspectedTasks: number;
  readonly findings: readonly TaskImportDiagnostic[];
  readonly ok: boolean;
}

// ---------------------------------------------------------------------------
// legacy ledger migration contracts
// ---------------------------------------------------------------------------

export interface TaskLegacyLedgerMigrationEntry {
  readonly taskId: string;
  readonly taskPath: string;
  readonly taskFormat: 'json' | 'markdown';
  readonly status: string;
  readonly reason: 'missing-transition-id' | 'missing-transition-event';
  readonly transitionPath: string | null;
}

export interface TaskLegacyLedgerMigrationSkip {
  readonly taskId: string;
  readonly taskPath: string;
  readonly taskFormat: 'json' | 'markdown';
  readonly reason: string;
}

export interface TaskLegacyLedgerMigrationReport {
  readonly schemaId: 'atm.taskLegacyLedgerMigrationReport';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly mode: 'dry-run' | 'apply';
  readonly taskRoot: string;
  readonly eventRoot: string;
  readonly inspectedTaskCount: number;
  readonly migratableTaskCount: number;
  readonly migratedTaskCount: number;
  readonly skippedTaskCount: number;
  readonly migratedTasks: readonly TaskLegacyLedgerMigrationEntry[];
  readonly skippedTasks: readonly TaskLegacyLedgerMigrationSkip[];
}

// ---------------------------------------------------------------------------
// deliverable gate contract
// ---------------------------------------------------------------------------

export interface TaskDeliverableGateReport {
  readonly schemaId: 'atm.taskDeliverableGate.v1';
  readonly generatedAt: string;
  readonly taskId: string;
  readonly deliveryPrinciple: string;
  readonly required: boolean;
  readonly ok: boolean;
  readonly reason: string;
  readonly changedFiles: readonly string[];
  readonly deliverableFiles: readonly string[];
  readonly declaredFiles: readonly string[];
  readonly historicalDeliveries: readonly TaskHistoricalDeliveryReport[];
  readonly notAllowedAsCompletion: readonly string[];
  readonly remediation: string;
  readonly requiredCommand: string | null;
}

// ---------------------------------------------------------------------------
// schemaId / specVersion identifiers — exported so additive-field tolerance
// tests can pin them and reject silent renames.
// ---------------------------------------------------------------------------

export const TASK_IMPORT_MANIFEST_SCHEMA_ID = 'atm.taskImportManifest' as const;
export const TASK_VERIFY_REPORT_SCHEMA_ID = 'atm.taskVerifyReport' as const;
export const TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID = 'atm.taskLegacyLedgerMigrationReport' as const;
export const TASK_DELIVERABLE_GATE_SCHEMA_ID = 'atm.taskDeliverableGate.v1' as const;
export const TASK_RESULT_CONTRACT_SPEC_VERSION = '0.1.0' as const;

/**
 * Stable list of known result-contract schemaIds. The validator and additive
 * tolerance spec read this to assert no contract was silently dropped.
 */
export const KNOWN_TASK_RESULT_CONTRACT_SCHEMA_IDS = [
  TASK_IMPORT_MANIFEST_SCHEMA_ID,
  TASK_VERIFY_REPORT_SCHEMA_ID,
  TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID,
  TASK_DELIVERABLE_GATE_SCHEMA_ID
] as const;

export type KnownTaskResultContractSchemaId =
  typeof KNOWN_TASK_RESULT_CONTRACT_SCHEMA_IDS[number];

/**
 * Tolerance helper: returns true when the candidate object structurally matches
 * the named contract (schemaId match) without rejecting additional fields. This
 * is the canonical "additive fields OK, rename/remove NOT OK" check.
 */
export function isKnownTaskResultContract(
  candidate: unknown,
  schemaId: KnownTaskResultContractSchemaId
): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  const record = candidate as Record<string, unknown>;
  return record.schemaId === schemaId;
}
