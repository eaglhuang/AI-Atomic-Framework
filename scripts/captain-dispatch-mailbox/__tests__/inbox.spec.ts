import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureLayout, resolveLayout } from '../layout.ts';
import { createLedger } from '../ledger.ts';
import { createSummary } from '../render.ts';
import { dispatchQueuedWork, scanUnclaimed, seedDemoQueue } from '../lanes/inbox.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atm-mailbox-inbox-'));
try {
  const options = {
    root,
    agents: [{ id: '001', model: 'gpt-test' }],
    captainModel: 'codex-test',
    workerModel: 'gpt-test',
    role: 'captain' as const,
    agentId: null,
    completeActive: false,
    reportStatus: 'done',
    reportSummary: null,
    reportEvidence: [],
    reportFile: null,
    staleMinutes: 0,
    maxDispatch: 3,
    captainNoReportLimit: 5,
    captainNoDispatchMinutes: 10,
    workerNoDispatchLimit: 10,
    workerNoReportMinutes: 15,
    clearStopLoss: false,
    reset: false,
    seedDemo: true,
    simulateWorkers: false,
    assertClean: false,
    json: true,
    help: false
  };
  const layout = resolveLayout(root, options.agents);
  ensureLayout(layout);
  const ledger = createLedger(options);
  const summary = createSummary(root, options);

  const seeded = seedDemoQueue(layout);
  assert.ok(seeded.length > 0, 'demo queue must seed jobs');

  dispatchQueuedWork(layout, ledger, options, summary);
  assert.ok(summary.dispatched.length > 0, 'dispatch must claim seeded work');

  const stale = scanUnclaimed(layout, options);
  assert.ok(Array.isArray(stale));
  console.log('inbox.spec.ts: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
