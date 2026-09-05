import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeTransactionStatusPath, readCloseTransactionStatus, writeCloseTransactionStatus } from './close-transaction-status.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-close-status-'));
try {
  const started = writeCloseTransactionStatus({ cwd, taskId: 'TASK-CLOSE-STATUS-0001', phase: 'started' });
  assert.equal(started.outcome, 'in-progress');
  assert.equal(readCloseTransactionStatus(cwd, started.taskId)?.phase, 'started');
  const committed = writeCloseTransactionStatus({ cwd, taskId: started.taskId, phase: 'ledger-written', ledgerCommit: 'a'.repeat(40) });
  assert.equal(committed.ledgerCommit, 'a'.repeat(40));
  assert.equal(readCloseTransactionStatus(cwd, started.taskId)?.startedAt, started.startedAt);
  const complete = writeCloseTransactionStatus({ cwd, taskId: started.taskId, phase: 'post-cleanup-complete', cleanupComplete: true, targetCommit: 'b'.repeat(40), planningCommit: 'c'.repeat(40) });
  assert.equal(complete.outcome, 'completed');
  assert.equal(complete.cleanupComplete, true);
  assert.match(complete.recoveryCommand, /taskflow status/);
  assert.equal(closeTransactionStatusPath(cwd, started.taskId).endsWith(`${started.taskId}.json`), true);
  console.log('close transaction status: ok');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
