// TASK-RFT-0013 spec — close-window-diagnostics cluster.
import { readDeferredForeignStagedFilesForActiveCloseWindow, evaluateFrameworkDeliveryWindow, loadHistoricalBatchCloseSlice } from '../close-helpers/close-window-diagnostics.js';
import { CliError } from '../../shared.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
function fail(msg) {
    console.error(`[close-helpers-close-window-diagnostics.spec] ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
}
function assert(cond, msg) { if (!cond)
    fail(msg); }
const tmp = mkdtempSync(path.join(tmpdir(), 'rft13-cwd-'));
// happy / no-op — no lock present -> empty list.
const empty = readDeferredForeignStagedFilesForActiveCloseWindow(tmp, 'TASK-RFT-0013');
assert(Array.isArray(empty) && empty.length === 0, 'no lock -> empty list');
// happy path — evaluateFrameworkDeliveryWindow returns ok=true for historical-delivery ref.
const okResult = evaluateFrameworkDeliveryWindow({
    cwd: tmp,
    taskId: 'TASK-RFT-0013',
    actorId: 'test-actor',
    batchId: null,
    fromBatchCheckpoint: false,
    taskDeclaredFiles: ['packages/cli/src/commands/tasks.ts'],
    criticalChangedFiles: [],
    historicalDeliveryRefs: ['deadbeef']
});
assert(okResult.ok === true, 'historical delivery -> ok');
assert(okResult.schemaId === 'atm.frameworkDeliveryWindow.v1', 'schema id present');
// failure branch — no governed delivery flag -> ok=false.
const notOk = evaluateFrameworkDeliveryWindow({
    cwd: tmp,
    taskId: 'TASK-RFT-0013',
    actorId: 'test-actor',
    batchId: null,
    fromBatchCheckpoint: false,
    taskDeclaredFiles: [],
    criticalChangedFiles: [],
    historicalDeliveryRefs: []
});
assert(notOk.ok === false && notOk.reason === 'not-from-batch-checkpoint', 'no delivery -> not-from-batch-checkpoint');
// rollback / error — missing historical batch file throws CliError.
try {
    loadHistoricalBatchCloseSlice(tmp, 'TASK-RFT-0013', 'nonexistent-batch');
    fail('expected CliError for missing batch');
}
catch (err) {
    assert(err instanceof CliError, 'error is CliError');
    assert(err.code === 'ATM_TASK_CLOSE_HISTORICAL_BATCH_NOT_FOUND', 'code matches');
}
console.log('[close-helpers-close-window-diagnostics.spec] ok (4 branches)');
