/**
 * TASK-RFT-0010 spec — tasks result-contracts.
 *
 * Covers contract stability + additive-field tolerance.
 *
 * The spec pins the schemaIds and the known-contract set so future edits to
 * `result-contracts.ts` cannot silently rename / remove a contract.
 */
import {
  KNOWN_TASK_RESULT_CONTRACT_SCHEMA_IDS,
  TASK_DELIVERABLE_GATE_SCHEMA_ID,
  TASK_IMPORT_MANIFEST_SCHEMA_ID,
  TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID,
  TASK_RESULT_CONTRACT_SPEC_VERSION,
  TASK_VERIFY_REPORT_SCHEMA_ID,
  isKnownTaskResultContract
} from '../result-contracts.ts';

function fail(message: string): never {
  console.error(`[result-contracts.spec] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// --- pinned schemaIds (rename/remove guard) ---
assert(TASK_IMPORT_MANIFEST_SCHEMA_ID === 'atm.taskImportManifest', 'import manifest schemaId is frozen');
assert(TASK_VERIFY_REPORT_SCHEMA_ID === 'atm.taskVerifyReport', 'verify report schemaId is frozen');
assert(TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID === 'atm.taskLegacyLedgerMigrationReport', 'legacy ledger migration schemaId is frozen');
assert(TASK_DELIVERABLE_GATE_SCHEMA_ID === 'atm.taskDeliverableGate.v1', 'deliverable gate schemaId is frozen');
assert(TASK_RESULT_CONTRACT_SPEC_VERSION === '0.1.0', 'specVersion is frozen at 0.1.0');

// --- known-contract set (drop guard) ---
const expected = [
  'atm.taskImportManifest',
  'atm.taskVerifyReport',
  'atm.taskLegacyLedgerMigrationReport',
  'atm.taskDeliverableGate.v1'
];
for (const id of expected) {
  assert(
    KNOWN_TASK_RESULT_CONTRACT_SCHEMA_IDS.includes(id as never),
    `KNOWN_TASK_RESULT_CONTRACT_SCHEMA_IDS must continue to include ${id}`
  );
}
assert(
  KNOWN_TASK_RESULT_CONTRACT_SCHEMA_IDS.length === expected.length,
  'KNOWN_TASK_RESULT_CONTRACT_SCHEMA_IDS must not grow silently — add a new schema to the spec when extending'
);

// --- additive field tolerance ---
const baseManifest = {
  schemaId: TASK_IMPORT_MANIFEST_SCHEMA_ID,
  specVersion: TASK_RESULT_CONTRACT_SPEC_VERSION,
  generatedAt: '2026-07-01T00:00:00.000Z',
  planPath: 'docs/plan.md',
  mode: 'write',
  tasks: [],
  diagnostics: [],
  writtenPaths: [],
  evidencePath: null
};
assert(isKnownTaskResultContract(baseManifest, TASK_IMPORT_MANIFEST_SCHEMA_ID), 'canonical manifest recognized');

const additive = { ...baseManifest, futureFieldThatAdoptersMayAdd: 'tolerated' };
assert(isKnownTaskResultContract(additive, TASK_IMPORT_MANIFEST_SCHEMA_ID), 'unknown additive fields must be tolerated');

const renamed = { ...baseManifest, schemaId: 'atm.taskImportManifestV2' };
assert(!isKnownTaskResultContract(renamed, TASK_IMPORT_MANIFEST_SCHEMA_ID), 'rename of schemaId must be rejected');

assert(!isKnownTaskResultContract(null, TASK_IMPORT_MANIFEST_SCHEMA_ID), 'null is not a contract');
assert(!isKnownTaskResultContract('string', TASK_IMPORT_MANIFEST_SCHEMA_ID), 'primitive is not a contract');

// --- cross-contract rejection ---
const verifyShapedAsImport = {
  schemaId: TASK_VERIFY_REPORT_SCHEMA_ID,
  ok: true,
  findings: []
};
assert(!isKnownTaskResultContract(verifyShapedAsImport, TASK_IMPORT_MANIFEST_SCHEMA_ID), 'verify report must not pass import manifest gate');
assert(isKnownTaskResultContract(verifyShapedAsImport, TASK_VERIFY_REPORT_SCHEMA_ID), 'verify report passes its own gate');

console.log('[result-contracts.spec] ok');
