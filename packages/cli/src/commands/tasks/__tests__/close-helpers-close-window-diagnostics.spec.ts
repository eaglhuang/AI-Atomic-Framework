// TASK-RFT-0013 spec — close-window-diagnostics cluster.

import {
  readDeferredForeignStagedFilesForActiveCloseWindow,
  evaluateFrameworkDeliveryWindow,
  loadHistoricalBatchCloseSlice
} from '../close-helpers/close-window-diagnostics.ts';
import { buildTaskFrameworkLockContext } from '../../framework-development/framework-lock-context.ts';
import { CliError } from '../../shared.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function fail(msg: string): never {
  console.error(`[close-helpers-close-window-diagnostics.spec] ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function assert(cond: unknown, msg: string) { if (!cond) fail(msg); }

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

// batch checkpoint may close a retroactive framework task from an already-landed
// historical delivery commit; it must not require the same critical diff to be
// dirty again in the current worktree.
const batchHistoricalResult = evaluateFrameworkDeliveryWindow({
  cwd: tmp,
  taskId: 'TASK-RFT-0013',
  actorId: 'test-actor',
  batchId: 'batch-test',
  fromBatchCheckpoint: true,
  taskDeclaredFiles: ['packages/cli/src/commands/tasks.ts'],
  criticalChangedFiles: [],
  historicalDeliveryRefs: ['deadbeef']
});
assert(batchHistoricalResult.ok === true, 'batch checkpoint historical delivery -> ok without active diff');
assert(batchHistoricalResult.reason === 'batch-checkpoint-historical-delivery', 'batch historical reason is explicit');

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

// A task may close while its own active framework lock exists; the terminal
// transition releases that lock. Foreign locks remain a fail-closed blocker.
const ownLockContext = buildTaskFrameworkLockContext({
  blockers: ['framework-stale-lock-cleanup-required'],
  staleLocks: [{ kind: 'still-active', linkedTaskId: 'TASK-RFT-0013', actorId: 'test-actor' }],
  taskId: 'TASK-RFT-0013',
  actorId: 'test-actor'
});
assert(ownLockContext.blockers.length === 0 && ownLockContext.staleLocks.length === 0, 'own active lock is transition context, not stale cleanup');
const foreignLockContext = buildTaskFrameworkLockContext({
  blockers: ['framework-stale-lock-cleanup-required'],
  staleLocks: [{ kind: 'still-active', linkedTaskId: 'TASK-OTHER-0001', actorId: 'other-actor' }],
  taskId: 'TASK-RFT-0013',
  actorId: 'test-actor'
});
assert(foreignLockContext.blockers.length === 1 && foreignLockContext.staleLocks.length === 1, 'foreign active lock remains blocking');

// rollback / error — missing historical batch file throws CliError.
try {
  loadHistoricalBatchCloseSlice(tmp, 'TASK-RFT-0013', 'nonexistent-batch');
  fail('expected CliError for missing batch');
} catch (err) {
  assert(err instanceof CliError, 'error is CliError');
  assert((err as CliError).code === 'ATM_TASK_CLOSE_HISTORICAL_BATCH_NOT_FOUND', 'code matches');
}

console.log('[close-helpers-close-window-diagnostics.spec] ok (7 branches)');
