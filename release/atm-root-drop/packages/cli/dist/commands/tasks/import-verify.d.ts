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
import { type TaskImportManifest, type TaskImportRecord, type TaskImportDiagnostic, type TaskVerifyReport, type TaskLegacyLedgerMigrationReport, type TaskLegacyLedgerMigrationEntry, type TaskLegacyLedgerMigrationSkip } from './result-contracts.ts';
export interface NormalizeImportDiagnosticInput {
    readonly level: 'info' | 'warning' | 'error';
    readonly code: string;
    readonly text: string;
    readonly workItemId?: string | null;
    readonly sourceLine?: number | null;
}
export declare function normalizeImportDiagnostic(input: NormalizeImportDiagnosticInput): TaskImportDiagnostic;
/**
 * Convert an unknown error (typically thrown from a plugin parse) into a
 * normalized `error`-severity diagnostic. Used by import + verify when an
 * adapter blows up partway through.
 */
export declare function importDiagnosticFromUnknownError(code: string, err: unknown, workItemId?: string | null): TaskImportDiagnostic;
/**
 * Classifier states for `tasks import --write --reset-open`. The purpose is to
 * distinguish the *normal* Phase 0 → Phase 1 handoff (planning card marked
 * `in-progress`, but no runtime ledger has been opened yet) from the *safety*
 * cases where reset-open would clobber a real active claim.
 */
export type TaskImportResetOpenState = 'fresh-open' | 'drift-with-active-claim' | 'drift-without-claim' | 'planning-in-progress-no-runtime';
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
export declare function classifyResetOpenImport(input: TaskImportResetOpenInput): TaskImportResetOpenClassification;
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
export declare function buildTaskImportManifest(input: BuildTaskImportManifestInput): TaskImportManifest;
export interface BuildTaskVerifyReportInput {
    readonly taskStorePath: string;
    readonly inspectedTasks: number;
    readonly findings: readonly TaskImportDiagnostic[];
    readonly now?: () => Date;
}
export declare function buildTaskVerifyReport(input: BuildTaskVerifyReportInput): TaskVerifyReport;
export interface NormalizeMigrationEntryInput {
    readonly taskId: string;
    readonly taskPath: string;
    readonly taskFormat: 'json' | 'markdown';
    readonly status: string;
    readonly reason: 'missing-transition-id' | 'missing-transition-event';
    readonly transitionPath: string | null;
}
export declare function normalizeMigrationEntry(input: NormalizeMigrationEntryInput): TaskLegacyLedgerMigrationEntry;
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
export declare function buildTaskLegacyLedgerMigrationReport(input: BuildTaskLegacyLedgerMigrationReportInput): TaskLegacyLedgerMigrationReport;
/**
 * Sort diagnostics so errors precede warnings precede infos, and within a
 * level the order is stable by code then by workItemId. Used by verify
 * envelope assembly so JSON output is reviewer-friendly.
 */
export declare function sortImportDiagnostics(findings: readonly TaskImportDiagnostic[]): readonly TaskImportDiagnostic[];
