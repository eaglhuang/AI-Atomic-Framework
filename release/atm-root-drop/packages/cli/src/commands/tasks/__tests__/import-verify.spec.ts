/**
 * TASK-RFT-0010 spec — tasks.ledger.import.verify.
 *
 * Covers import success / verify failure / migration normalization envelopes.
 */
import {
  buildTaskImportManifest,
  buildTaskLegacyLedgerMigrationReport,
  buildTaskVerifyReport,
  importDiagnosticFromUnknownError,
  normalizeImportDiagnostic,
  normalizeMigrationEntry,
  sortImportDiagnostics
} from '../import-verify.ts';
import {
  TASK_IMPORT_MANIFEST_SCHEMA_ID,
  TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID,
  TASK_RESULT_CONTRACT_SPEC_VERSION,
  TASK_VERIFY_REPORT_SCHEMA_ID
} from '../result-contracts.ts';

function fail(message: string): never {
  console.error(`[import-verify.spec] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

const fixedNow = () => new Date('2026-07-01T12:00:00.000Z');

// --- import success envelope ---
const importOk = buildTaskImportManifest({
  planPath: 'docs/plan.md',
  mode: 'write',
  tasks: [],
  diagnostics: [],
  writtenPaths: ['.atm/tasks/TASK-X.json'],
  evidencePath: '.atm/history/evidence/import.json',
  now: fixedNow
});
assert(importOk.schemaId === TASK_IMPORT_MANIFEST_SCHEMA_ID, 'import manifest schemaId must be pinned');
assert(importOk.specVersion === TASK_RESULT_CONTRACT_SPEC_VERSION, 'import manifest specVersion must be pinned');
assert(importOk.generatedAt === '2026-07-01T12:00:00.000Z', 'generatedAt must use injected clock');
assert(importOk.mode === 'write', 'mode preserved');
assert(importOk.writtenPaths.length === 1, 'writtenPaths preserved');

// --- verify failure envelope ---
const verifyFail = buildTaskVerifyReport({
  taskStorePath: '.atm/tasks',
  inspectedTasks: 3,
  findings: [
    normalizeImportDiagnostic({ level: 'error', code: 'E1', text: 'broken', workItemId: 'TASK-A' }),
    normalizeImportDiagnostic({ level: 'warning', code: 'W1', text: 'fyi' })
  ],
  now: fixedNow
});
assert(verifyFail.schemaId === TASK_VERIFY_REPORT_SCHEMA_ID, 'verify schemaId pinned');
assert(verifyFail.ok === false, 'any error finding flips ok to false');
assert(verifyFail.findings.length === 2, 'findings preserved');

const verifyPass = buildTaskVerifyReport({
  taskStorePath: '.atm/tasks',
  inspectedTasks: 0,
  findings: [],
  now: fixedNow
});
assert(verifyPass.ok === true, 'empty findings means ok');

// --- migration normalization ---
const entry = normalizeMigrationEntry({
  taskId: 'TASK-OLD',
  taskPath: '.atm/tasks/TASK-OLD.json',
  taskFormat: 'json',
  status: 'done',
  reason: 'missing-transition-id',
  transitionPath: null
});
assert(entry.taskId === 'TASK-OLD' && entry.reason === 'missing-transition-id', 'migration entry normalized');

const migrationReport = buildTaskLegacyLedgerMigrationReport({
  mode: 'apply',
  taskRoot: '.atm/tasks',
  eventRoot: '.atm/events',
  inspectedTaskCount: 5,
  migratableTaskCount: 2,
  migratedTasks: [entry],
  skippedTasks: [{ taskId: 'TASK-SKIP', taskPath: '.atm/tasks/TASK-SKIP.json', taskFormat: 'markdown', reason: 'no-migration-needed' }],
  now: fixedNow
});
assert(migrationReport.schemaId === TASK_LEGACY_LEDGER_MIGRATION_SCHEMA_ID, 'migration schemaId pinned');
assert(migrationReport.migratedTaskCount === 1, 'migratedTaskCount derived from list');
assert(migrationReport.skippedTaskCount === 1, 'skippedTaskCount derived from list');
assert(migrationReport.mode === 'apply', 'mode preserved');

// --- unknown-error → diagnostic ---
const errDiag = importDiagnosticFromUnknownError('PLUGIN_FAIL', new Error('boom'), 'TASK-Q');
assert(errDiag.level === 'error' && errDiag.code === 'PLUGIN_FAIL' && errDiag.text === 'boom' && errDiag.workItemId === 'TASK-Q', 'unknown error normalized');

// --- diagnostic sort: errors → warnings → infos ---
const sorted = sortImportDiagnostics([
  normalizeImportDiagnostic({ level: 'info', code: 'I1', text: 'a' }),
  normalizeImportDiagnostic({ level: 'error', code: 'E2', text: 'a' }),
  normalizeImportDiagnostic({ level: 'warning', code: 'W1', text: 'a' }),
  normalizeImportDiagnostic({ level: 'error', code: 'E1', text: 'a' })
]);
assert(sorted[0].level === 'error' && sorted[0].code === 'E1', 'errors sort first and by code');
assert(sorted[1].code === 'E2', 'second error follows');
assert(sorted[2].level === 'warning' && sorted[3].level === 'info', 'warnings before infos');

console.log('[import-verify.spec] ok');
