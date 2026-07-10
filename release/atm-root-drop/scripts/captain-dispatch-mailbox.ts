#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs, printHelp } from './captain-dispatch-mailbox/cli.ts';
import { acquireLock, ensureLayout, resolveLayout } from './captain-dispatch-mailbox/layout.ts';
import { readLedger, writeLedger } from './captain-dispatch-mailbox/ledger.ts';
import {
  clearActorStopLoss,
  evaluateStopLoss,
  isActorStopLossPaused,
  markAlreadyPausedStopLoss
} from './captain-dispatch-mailbox/stop-loss.ts';
import {
  buildDecisionBasis,
  chooseNextAction,
  computeBacklog,
  createSummary,
  emitSummary,
  writeCaptainHandoff,
  writeWorkerHandoff
} from './captain-dispatch-mailbox/render.ts';
import { dispatchQueuedWork, scanUnclaimed, seedDemoQueue } from './captain-dispatch-mailbox/lanes/inbox.ts';
import { pollOneWorker, pollWorkers } from './captain-dispatch-mailbox/lanes/outbox.ts';
import { receiveCaptainReports } from './captain-dispatch-mailbox/lanes/reports.ts';

export type * from './captain-dispatch-mailbox/types.ts';
export { parseArgs, printHelp } from './captain-dispatch-mailbox/cli.ts';
export { resolveLayout, ensureLayout, acquireLock, requireAgentLayout } from './captain-dispatch-mailbox/layout.ts';
export { readLedger, writeLedger, createLedger } from './captain-dispatch-mailbox/ledger.ts';
export {
  createStopLossState,
  createWorkerStopLossState,
  normalizeStopLoss
} from './captain-dispatch-mailbox/stop-loss.ts';
export { fmString, resolveDispatchId } from './captain-dispatch-mailbox/frontmatter.ts';
export { dispatchQueuedWork, scanUnclaimed, seedDemoQueue } from './captain-dispatch-mailbox/lanes/inbox.ts';
export { pollWorkers, pollOneWorker, completeSimulatedWorker } from './captain-dispatch-mailbox/lanes/outbox.ts';
export { receiveCaptainReports, isThinDoneReport } from './captain-dispatch-mailbox/lanes/reports.ts';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const root = path.resolve(options.root);
  if (options.reset && existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }

  const layout = resolveLayout(root, options.agents);
  ensureLayout(layout);
  const releaseLock = acquireLock(layout);
  const summary = createSummary(root, options);

  try {
    const ledger = readLedger(layout, options);
    if (options.clearStopLoss) {
      clearActorStopLoss(ledger, options, summary);
    }
    summary.cycleInputBacklog = computeBacklog(layout, options);

    if (!options.clearStopLoss) {
      if (isActorStopLossPaused(ledger, options)) {
        markAlreadyPausedStopLoss(layout, ledger, options, summary);
      } else {
        if (options.seedDemo) {
          summary.seededDemoJobs = seedDemoQueue(layout);
        }
        summary.cycleInputBacklog = computeBacklog(layout, options);

        if (options.role === 'captain') {
          receiveCaptainReports(layout, ledger, summary, 'cycle-start');
          dispatchQueuedWork(layout, ledger, options, summary);
          receiveCaptainReports(layout, ledger, summary, 'cycle-end');
        } else if (options.role === 'worker') {
          pollOneWorker(layout, ledger, options, summary);
        } else {
          receiveCaptainReports(layout, ledger, summary, 'cycle-start');
          dispatchQueuedWork(layout, ledger, options, summary);
          pollWorkers(layout, ledger, options, summary);
          receiveCaptainReports(layout, ledger, summary, 'cycle-end');
        }
      }
    }

    summary.staleUnclaimed = scanUnclaimed(layout, options);
    summary.backlog = computeBacklog(layout, options);
    if (!summary.stopLoss.paused && !options.clearStopLoss) {
      evaluateStopLoss(layout, ledger, options, summary);
    }
    summary.readyForNextCycle = !summary.stopLoss.shouldStop
      && summary.backlog.captain.queue === 0
      && summary.backlog.captain.inbox === 0
      && Object.values(summary.backlog.agents).every((agent) => agent.inbox === 0 && agent.active === 0)
      && summary.staleUnclaimed.length === 0;
    summary.decisionPacket.basis = buildDecisionBasis(summary, options);
    summary.decisionPacket.nextAction = chooseNextAction(summary, options);
    if (options.role === 'captain' || options.role === 'all') {
      summary.handoffPath = writeCaptainHandoff(layout, ledger, summary);
    } else if (options.role === 'worker') {
      summary.handoffPath = writeWorkerHandoff(layout, options, summary);
    }
    summary.ok = summary.errors.length === 0 && (!options.assertClean || summary.readyForNextCycle || summary.stopLoss.shouldStop);
    summary.cycleFinishedAt = new Date().toISOString();

    writeLedger(layout, ledger);
  } finally {
    releaseLock();
  }

  emitSummary(summary, options.json);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[captain-dispatch-mailbox] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
