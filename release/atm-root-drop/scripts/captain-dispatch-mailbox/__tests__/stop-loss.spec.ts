import assert from 'node:assert/strict';
import {
  createStopLossState,
  createWorkerStopLossState,
  normalizeStopLoss
} from '../stop-loss.ts';

const options = {
  root: '.',
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
  captainNoReportLimit: 2,
  captainNoDispatchMinutes: 1,
  workerNoDispatchLimit: 2,
  workerNoReportMinutes: 1,
  clearStopLoss: false,
  reset: false,
  seedDemo: false,
  simulateWorkers: false,
  assertClean: false,
  json: true,
  help: false
};

const within = createStopLossState(options);
assert.equal(within.captain.paused, false);
assert.equal(within.captain.noReportCycles, 0);

const worker = createWorkerStopLossState();
assert.equal(worker.paused, false);
assert.equal(worker.noDispatchCycles, 0);

const normalized = normalizeStopLoss(
  {
    captain: { noReportCycles: 9, paused: true, noDispatchSince: null, stoppedAt: null, lastTrigger: 'cap', lastStopLossReportPath: null },
    workers: { '001': { ...worker, noDispatchCycles: 9, paused: true } }
  },
  options
);
assert.equal(normalized.captain.paused, true);
assert.equal(normalized.workers['001']?.paused, true);
assert.ok(normalized.captain.noReportCycles >= 2 || normalized.captain.paused);

console.log('stop-loss.spec.ts: ok');
