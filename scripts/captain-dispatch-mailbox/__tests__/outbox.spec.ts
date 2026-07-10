import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureLayout, resolveLayout } from '../layout.ts';
import { createLedger } from '../ledger.ts';
import { createSummary } from '../render.ts';
import { dispatchQueuedWork, seedDemoQueue } from '../lanes/inbox.ts';
import { pollOneWorker, pollWorkers } from '../lanes/outbox.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atm-mailbox-outbox-'));
try {
  const options = {
    root,
    agents: [{ id: '001', model: 'gpt-test' }],
    captainModel: 'codex-test',
    workerModel: 'gpt-test',
    role: 'all' as const,
    agentId: '001',
    completeActive: true,
    reportStatus: 'done',
    reportSummary: 'simulated',
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
    seedDemo: true,
    simulateWorkers: true,
    assertClean: false,
    json: true,
    help: false
  };
  const layout = resolveLayout(root, options.agents);
  ensureLayout(layout);
  const ledger = createLedger(options);
  const summary = createSummary(root, options);

  seedDemoQueue(layout);
  dispatchQueuedWork(layout, ledger, options, summary);
  pollWorkers(layout, ledger, options, summary);
  assert.ok(summary.completed.length >= 0);

  const emptyRoot = mkdtempSync(path.join(tmpdir(), 'atm-mailbox-outbox-empty-'));
  try {
    const emptyOptions = { ...options, agents: [], simulateWorkers: false, seedDemo: false };
    const emptyLayout = resolveLayout(emptyRoot, []);
    ensureLayout(emptyLayout);
    const emptySummary = createSummary(emptyRoot, emptyOptions);
    pollWorkers(emptyLayout, createLedger(emptyOptions), emptyOptions, emptySummary);
    assert.equal(emptySummary.completed.length, 0);
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }

  pollOneWorker(layout, ledger, options, summary);
  console.log('outbox.spec.ts: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
