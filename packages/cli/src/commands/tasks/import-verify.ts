/**
 * TASK-RFT-0010 — tasks.ledger.import.verify atom.
 *
 * Result Contract Object owner for `tasks import` / `tasks verify` / legacy
 * ledger migration envelopes. Owns:
 *   - the typed envelope builders for the three result contracts
 *   - a small classifier that converts plugin / parse / write failures into
 *     normalized `TaskImportDiagnostic` rows
 *   - the migration normalizer that turns a partial entry into a stable
 *     `TaskLegacyLedgerMigrationEntry`
 *
 * tasks.ts continues to own the orchestrating `runTasksImport`,
 * `runTasksVerify` and `runTasksMigrateLegacyLedger` flows, but those flows
 * now route every envelope-shaping decision through here so the JSON contract
 * is owned in one place.
 */

import {
  TASK_IMPORT_MANIFEST_SCHEMA_ID,
  TASK_VERIFY_REPORT_SCHEMA_ID,
  TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID,
  TASK_RESULT_CONTRACT_SPEC_VERSION,
  type TaskImportManifest,
  type TaskImportRecord,
  type TaskImportDiagnostic,
  type TaskVerifyReport,
  type TaskLegacyLedgerMigrationReport,
  type TaskLegacyLedgerMigrationEntry,
  type TaskLegacyLedgerMigrationSkip
} from './result-contracts.ts';

// ---------------------------------------------------------------------------
// Diagnostic normalization
// ---------------------------------------------------------------------------

export interface NormalizeImportDiagnosticInput {
  readonly level: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly text: string;
  readonly workItemId?: string | null;
  readonly sourceLine?: number | null;
}

export function normalizeImportDiagnostic(
  input: NormalizeImportDiagnosticInput
): TaskImportDiagnostic {
  const diagnostic: {
    level: 'info' | 'warning' | 'error';
    code: string;
    text: string;
    workItemId?: string;
    sourceLine?: number;
  } = {
    level: input.level,
    code: input.code,
    text: input.text
  };
  if (input.workItemId) diagnostic.workItemId = input.workItemId;
  if (typeof input.sourceLine === 'number' && Number.isFinite(input.sourceLine)) {
    diagnostic.sourceLine = input.sourceLine;
  }
  return diagnostic;
}

/**
 * Convert an unknown error (typically thrown from a plugin parse) into a
 * normalized `error`-severity diagnostic. Used by import + verify when an
 * adapter blows up partway through.
 */
export function importDiagnosticFromUnknownError(
  code: string,
  err: unknown,
  workItemId?: string | null
): TaskImportDiagnostic {
  const text = err instanceof Error ? err.message : String(err);
  return normalizeImportDiagnostic({
    level: 'error',
    code,
    text,
    workItemId
  });
}

// ---------------------------------------------------------------------------
// TASK-RFT-0011 — reset-open UX classifier
// ---------------------------------------------------------------------------

/**
 * Classifier states for `tasks import --write --reset-open`. The purpose is to
 * distinguish the *normal* Phase 0 → Phase 1 handoff (planning card marked
 * `in-progress`, but no runtime ledger has been opened yet) from the *safety*
 * cases where reset-open would clobber a real active claim.
 */
export type TaskImportResetOpenState =
  | 'fresh-open'
  | 'drift-with-active-claim'
  | 'drift-without-claim'
  | 'planning-in-progress-no-runtime';

export interface TaskImportResetOpenInput {
  /**
   * Planning-side card status parsed from the plan markdown / frontmatter. May
   * be null if the planning source declares no status.
   */
  readonly planningStatus: string | null;
  /** Runtime ledger record for the same task, or null when no runtime entry exists. */
  readonly runtimeLedgerStatus: string | null;
  /** Runtime ledger active-claim actor id, or null when no active claim exists. */
  readonly runtimeActiveClaimActorId: string | null;
}

export interface TaskImportResetOpenClassification {
  readonly state: TaskImportResetOpenState;
  /**
   * True when `--reset-open` may proceed WITHOUT an emergency lease. Only
   * `planning-in-progress-no-runtime` (and the trivial `fresh-open`) qualify;
   * every other state must still route through the emergency lane so an
   * operator explicitly acknowledges the runtime override.
   */
  readonly resetOpenEmergencyRequired: boolean;
  /** Human-readable diagnostic reason. */
  readonly reason: string;
}

const PLANNING_IN_PROGRESS_TOKENS = new Set([
  'in-progress',
  'in_progress',
  'inprogress',
  'wip',
  'started'
]);

const RUNTIME_ACTIVE_TOKENS = new Set([
  'in-progress',
  'in_progress',
  'claimed',
  'started'
]);

function normalizeStatusToken(raw: string | null): string {
  return (raw ?? '').trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Classify a `tasks import --reset-open` invocation.
 *
 * Rules:
 *   - `fresh-open`: no runtime ledger yet — the import can just open.
 *     `--reset-open` is a no-op here, do not gate.
 *   - `planning-in-progress-no-runtime`: planning card frontmatter is
 *     `in-progress` but no runtime claim exists. This is the normal
 *     Phase 0 → Phase 1 handoff after Captain writes `status: in-progress`
 *     into the plan card up-front. Allow reset-open without emergency lease.
 *   - `drift-with-active-claim`: some other actor still holds a live claim.
 *     `--reset-open` here really would clobber active work — keep emergency
 *     gating.
 *   - `drift-without-claim`: runtime ledger has drifted (e.g. stale
 *     `in-progress` without a live claim record). Emergency gating stays on
 *     for now; this atom does not soften that case.
 */
export function classifyResetOpenImport(
  input: TaskImportResetOpenInput
): TaskImportResetOpenClassification {
  const planningToken = normalizeStatusToken(input.planningStatus);
  const runtimeToken = normalizeStatusToken(input.runtimeLedgerStatus);
  const hasRuntimeLedger = runtimeToken.length > 0;
  const hasActiveClaim = typeof input.runtimeActiveClaimActorId === 'string'
    && input.runtimeActiveClaimActorId.trim().length > 0;

  if (!hasRuntimeLedger) {
    if (PLANNING_IN_PROGRESS_TOKENS.has(planningToken)) {
      return {
        state: 'planning-in-progress-no-runtime',
        resetOpenEmergencyRequired: false,
        reason: 'Planning frontmatter is in-progress; runtime ledger will open fresh — reset-open is safe without emergency lease.'
      };
    }
    return {
      state: 'fresh-open',
      resetOpenEmergencyRequired: false,
      reason: 'No runtime ledger entry exists; --reset-open is a no-op safe path.'
    };
  }

  if (hasActiveClaim) {
    return {
      state: 'drift-with-active-claim',
      resetOpenEmergencyRequired: true,
      reason: `Runtime ledger has an active claim held by ${input.runtimeActiveClaimActorId}; reset-open would clobber it and still requires an emergency lease.`
    };
  }

  if (RUNTIME_ACTIVE_TOKENS.has(runtimeToken)) {
    return {
      state: 'drift-without-claim',
      resetOpenEmergencyRequired: true,
      reason: 'Runtime ledger is active-flavored without an active claim record; drift is real — emergency lease still required.'
    };
  }

  return {
    state: 'fresh-open',
    resetOpenEmergencyRequired: false,
    reason: 'Runtime ledger is closed/inert; --reset-open is not a destructive action.'
  };
}

// ---------------------------------------------------------------------------
// Import manifest envelope
// ---------------------------------------------------------------------------

export interface BuildTaskImportManifestInput {
  readonly planPath: string;
  readonly mode: 'dry-run' | 'write';
  readonly tasks: readonly TaskImportRecord[];
  readonly diagnostics: readonly TaskImportDiagnostic[];
  readonly writtenPaths: readonly string[];
  readonly evidencePath: string | null;
  /** Optional override clock for deterministic tests. */
  readonly now?: () => Date;
}

export function buildTaskImportManifest(input: BuildTaskImportManifestInput): TaskImportManifest {
  const generatedAt = (input.now ? input.now() : new Date()).toISOString();
  return {
    schemaId: TASK_IMPORT_MANIFEST_SCHEMA_ID,
    specVersion: TASK_RESULT_CONTRACT_SPEC_VERSION,
    generatedAt,
    planPath: input.planPath,
    mode: input.mode,
    tasks: input.tasks,
    diagnostics: input.diagnostics,
    writtenPaths: input.writtenPaths,
    evidencePath: input.evidencePath
  };
}

// ---------------------------------------------------------------------------
// Verify report envelope
// ---------------------------------------------------------------------------

export interface BuildTaskVerifyReportInput {
  readonly taskStorePath: string;
  readonly inspectedTasks: number;
  readonly findings: readonly TaskImportDiagnostic[];
  readonly now?: () => Date;
}

export function buildTaskVerifyReport(input: BuildTaskVerifyReportInput): TaskVerifyReport {
  const generatedAt = (input.now ? input.now() : new Date()).toISOString();
  const ok = !input.findings.some((f) => f.level === 'error');
  return {
    schemaId: TASK_VERIFY_REPORT_SCHEMA_ID,
    specVersion: TASK_RESULT_CONTRACT_SPEC_VERSION,
    generatedAt,
    taskStorePath: input.taskStorePath,
    inspectedTasks: input.inspectedTasks,
    findings: input.findings,
    ok
  };
}

// ---------------------------------------------------------------------------
// Legacy ledger migration envelope + entry normalization
// ---------------------------------------------------------------------------

export interface NormalizeMigrationEntryInput {
  readonly taskId: string;
  readonly taskPath: string;
  readonly taskFormat: 'json' | 'markdown';
  readonly status: string;
  readonly reason: 'missing-transition-id' | 'missing-transition-event';
  readonly transitionPath: string | null;
}

export function normalizeMigrationEntry(
  input: NormalizeMigrationEntryInput
): TaskLegacyLedgerMigrationEntry {
  return {
    taskId: input.taskId,
    taskPath: input.taskPath,
    taskFormat: input.taskFormat,
    status: input.status,
    reason: input.reason,
    transitionPath: input.transitionPath
  };
}

export interface BuildTaskLegacyLedgerMigrationReportInput {
  readonly mode: 'dry-run' | 'apply';
  readonly taskRoot: string;
  readonly eventRoot: string;
  readonly inspectedTaskCount: number;
  readonly migratableTaskCount: number;
  readonly migratedTasks: readonly TaskLegacyLedgerMigrationEntry[];
  readonly skippedTasks: readonly TaskLegacyLedgerMigrationSkip[];
  readonly now?: () => Date;
}

export function buildTaskLegacyLedgerMigrationReport(
  input: BuildTaskLegacyLedgerMigrationReportInput
): TaskLegacyLedgerMigrationReport {
  const generatedAt = (input.now ? input.now() : new Date()).toISOString();
  return {
    schemaId: TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID,
    specVersion: TASK_RESULT_CONTRACT_SPEC_VERSION,
    generatedAt,
    mode: input.mode,
    taskRoot: input.taskRoot,
    eventRoot: input.eventRoot,
    inspectedTaskCount: input.inspectedTaskCount,
    migratableTaskCount: input.migratableTaskCount,
    migratedTaskCount: input.migratedTasks.length,
    skippedTaskCount: input.skippedTasks.length,
    migratedTasks: input.migratedTasks,
    skippedTasks: input.skippedTasks
  };
}

// ---------------------------------------------------------------------------
// Verify finding aggregation helper
// ---------------------------------------------------------------------------

/**
 * Sort diagnostics so errors precede warnings precede infos, and within a
 * level the order is stable by code then by workItemId. Used by verify
 * envelope assembly so JSON output is reviewer-friendly.
 */
export function sortImportDiagnostics(
  findings: readonly TaskImportDiagnostic[]
): readonly TaskImportDiagnostic[] {
  const levelOrder: Record<TaskImportDiagnostic['level'], number> = {
    error: 0,
    warning: 1,
    info: 2
  };
  return [...findings].sort((a, b) => {
    const levelDelta = levelOrder[a.level] - levelOrder[b.level];
    if (levelDelta !== 0) return levelDelta;
    const codeDelta = a.code.localeCompare(b.code);
    if (codeDelta !== 0) return codeDelta;
    return (a.workItemId ?? '').localeCompare(b.workItemId ?? '');
  });
}
