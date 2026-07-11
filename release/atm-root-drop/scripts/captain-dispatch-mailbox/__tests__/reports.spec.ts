import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureLayout, resolveLayout } from '../layout.ts';
import { createLedger } from '../ledger.ts';
import { createSummary } from '../render.ts';
import { isThinDoneReport, receiveCaptainReports } from '../lanes/reports.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atm-mailbox-reports-'));
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
  const ledger = createLedger(options);
  const summary = createSummary(root, options);

  mkdirSync(layout.captain.inbox, { recursive: true });
  const reportPath = path.join(layout.captain.inbox, 'demo.report.md');
  writeFileSync(
    reportPath,
    `---
type: captain-dispatch-report
dispatch_id: demo-dispatch
task_id: TASK-DEMO
from_agent: 001
to_agent: captain
status: done
---

# Report

Evidence attached.
`,
    'utf8'
  );

  receiveCaptainReports(layout, ledger, summary, 'cycle-start');
  const firstCount = summary.reportsReceived.length;
  receiveCaptainReports(layout, ledger, summary, 'cycle-start');
  assert.equal(summary.reportsReceived.length, firstCount, 'duplicate receive must be idempotent');

  assert.equal(isThinDoneReport('done', 'ok'), true);
  assert.equal(isThinDoneReport('blocked', 'needs work'), false);
  console.log('reports.spec.ts: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
