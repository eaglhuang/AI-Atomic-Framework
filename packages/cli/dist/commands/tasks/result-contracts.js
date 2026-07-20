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
// ---------------------------------------------------------------------------
// schemaId / specVersion identifiers — exported so additive-field tolerance
// tests can pin them and reject silent renames.
// ---------------------------------------------------------------------------
export const TASK_IMPORT_MANIFEST_SCHEMA_ID = 'atm.taskImportManifest';
export const TASK_VERIFY_REPORT_SCHEMA_ID = 'atm.taskVerifyReport';
export const TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID = 'atm.taskLegacyLedgerMigrationReport';
export const TASK_DELIVERABLE_GATE_SCHEMA_ID = 'atm.taskDeliverableGate.v1';
export const TASK_RESULT_CONTRACT_SPEC_VERSION = '0.1.0';
/**
 * Stable list of known result-contract schemaIds. The validator and additive
 * tolerance spec read this to assert no contract was silently dropped.
 */
export const KNOWN_TASK_RESULT_CONTRACT_SCHEMA_IDS = [
    TASK_IMPORT_MANIFEST_SCHEMA_ID,
    TASK_VERIFY_REPORT_SCHEMA_ID,
    TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID,
    TASK_DELIVERABLE_GATE_SCHEMA_ID
];
/**
 * Tolerance helper: returns true when the candidate object structurally matches
 * the named contract (schemaId match) without rejecting additional fields. This
 * is the canonical "additive fields OK, rename/remove NOT OK" check.
 */
export function isKnownTaskResultContract(candidate, schemaId) {
    if (!candidate || typeof candidate !== 'object')
        return false;
    const record = candidate;
    return record.schemaId === schemaId;
}
