import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureLayout, resolveLayout } from '../layout.ts';
import { createLedger, readLedger, writeLedger } from '../ledger.ts';
import { createStopLossState } from '../stop-loss.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atm-mailbox-ledger-'));
try {
  const options = {
    root,
    agents: [{ id: '001', model: 'gpt-test' }],
    captainModel: 'codex-test',
    workerModel: 'gpt-test',
    role: 'all' as const,
    agentId: null,
    completeActive: false,
    reportStatus: 'done',
    reportSummary: null,
    reportEvidence: [],
    reportFile: null,
    staleMinutes: 30,
    maxDispatch: 3,
    captainNoReportLimit: 5,
    captainNoDispatchMinutes: 10,
    workerNoDispatchLimit: 10,
    workerNoReportMinutes: 15,
    clearStopLoss: false,
    reset: false,
    seedDemo: false,
    simulateWorkers: false,
    assertClean: false,
    json: true,
    help: false
  };
  const layout = resolveLayout(root, options.agents);
  ensureLayout(layout);

  const missing = readLedger(layout, options);
  assert.equal(missing.schemaVersion, 1);
  assert.ok(missing.stopLoss);

  const created = createLedger(options);
  created.dispatches['d1'] = { id: 'd1', status: 'queued' };
  writeLedger(layout, created);
  const roundTrip = readLedger(layout, options);
  assert.equal(roundTrip.dispatches.d1?.id, 'd1');
  assert.deepEqual(Object.keys(createStopLossState(options).workers), ['001']);
  console.log('ledger.spec.ts: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
