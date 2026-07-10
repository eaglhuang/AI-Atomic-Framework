import { statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CaptainStopLossState,
  Ledger,
  MailboxLayout,
  MailboxOptions,
  MailboxSummary,
  StopLossState,
  WorkerStopLossState
} from './types.ts';
import { requireAgentLayout } from './layout.ts';
import {
  formatTimestampTag,
  listFiles,
  sanitizeFileName,
  toPortablePath,
  uniquePath
} from './fs-utils.ts';
import { fmString, parseMarkdownFile, resolveDispatchId } from './frontmatter.ts';

export function createStopLossState(options: MailboxOptions): StopLossState {
  const workers: Record<string, WorkerStopLossState> = {};
  for (const agent of options.agents) {
    workers[agent.id] = createWorkerStopLossState();
  }
  return {
    captain: {
      noReportCycles: 0,
      noDispatchSince: null,
      paused: false,
      stoppedAt: null,
      lastTrigger: null,
      lastStopLossReportPath: null
    },
    workers
  };
}

export function createWorkerStopLossState(): WorkerStopLossState {
  return {
    noDispatchCycles: 0,
    activeSince: null,
    paused: false,
    stoppedAt: null,
    lastTrigger: null,
    lastStopLossReportPath: null
  };
}

export function normalizeStopLoss(rawStopLoss: Partial<StopLossState> | undefined, options: MailboxOptions): StopLossState {
  const defaults = createStopLossState(options);
  const captainRaw = (rawStopLoss?.captain ?? {}) as Partial<CaptainStopLossState>;
  const captainNoReportCycles = Number(captainRaw.noReportCycles);
  const workers: Record<string, WorkerStopLossState> = {};

  for (const agent of options.agents) {
    const workerRaw = (rawStopLoss?.workers?.[agent.id] ?? {}) as Partial<WorkerStopLossState>;
    const workerNoDispatchCycles = Number(workerRaw.noDispatchCycles);
    workers[agent.id] = {
      ...defaults.workers[agent.id],
      ...workerRaw,
      noDispatchCycles: Number.isInteger(workerNoDispatchCycles) && workerNoDispatchCycles >= 0
        ? workerNoDispatchCycles
        : 0
    };
  }

  return {
    ...defaults,
    ...rawStopLoss,
    captain: {
      ...defaults.captain,
      ...captainRaw,
      noReportCycles: Number.isInteger(captainNoReportCycles) && captainNoReportCycles >= 0
        ? captainNoReportCycles
        : 0
    },
    workers
  };
}

export function isActorStopLossPaused(ledger: Ledger, options: MailboxOptions): boolean {
  if (options.role === 'worker') {
    return options.agentId ? Boolean(ledger.stopLoss?.workers?.[options.agentId]?.paused) : false;
  }
  return Boolean(ledger.stopLoss?.captain?.paused);
}

export function clearActorStopLoss(ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  if (options.role === 'worker') {
    if (options.agentId) {
      ledger.stopLoss.workers[options.agentId] = createWorkerStopLossState();
    }
  } else {
    ledger.stopLoss.captain = createStopLossState(options).captain;
  }
  summary.stopLoss.cleared = true;
  summary.stopLoss.paused = false;
  summary.stopLoss.shouldStop = false;
  summary.stopLoss.trigger = null;
  summary.stopLoss.reason = `Stop-loss state cleared for ${summary.stopLoss.actor}.`;
  summary.stopLoss.reportPath = null;
  summary.stopLoss.counters = {};
}

export function markAlreadyPausedStopLoss(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  const state = options.role === 'worker'
    ? (options.agentId ? ledger.stopLoss.workers[options.agentId] : createWorkerStopLossState())
    : ledger.stopLoss.captain;
  summary.stopLoss.shouldStop = true;
  summary.stopLoss.paused = true;
  summary.stopLoss.trigger = state.lastTrigger || 'already-paused';
  summary.stopLoss.reason = `${summary.stopLoss.actor} is already paused by stop-loss; no mailbox work was processed.`;
  summary.stopLoss.reportPath = state.lastStopLossReportPath;
  summary.stopLoss.counters = buildStopLossCounters(layout, ledger, options, state);
  summary.stopLoss.activeDispatches = options.role === 'worker' && options.agentId
    ? getWorkerActiveDispatches(layout, ledger, options.agentId)
    : [];
}

export function evaluateStopLoss(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  if (options.role === 'worker') {
    evaluateWorkerStopLoss(layout, ledger, options, summary);
    return;
  }

  evaluateCaptainStopLoss(layout, ledger, options, summary);
}

export function evaluateCaptainStopLoss(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  const state = ledger.stopLoss.captain;
  const hadQueuedWorkAtStart = (summary.cycleInputBacklog?.captain?.queue || 0) > 0 || summary.seededDemoJobs.length > 0;
  const hadActiveWorkAtStart = Object.values(summary.cycleInputBacklog?.agents || {}).some((agentBacklog) => (agentBacklog?.active || 0) > 0);
  const shouldTrackNoReports = hadQueuedWorkAtStart || hadActiveWorkAtStart;

  if (!shouldTrackNoReports || summary.reportsReceived.length > 0) {
    state.noReportCycles = 0;
  } else {
    state.noReportCycles += 1;
  }

  const hadDispatch = summary.dispatched.length > 0;
  if (hadDispatch) {
    state.noDispatchSince = null;
  } else if (hadQueuedWorkAtStart && !state.noDispatchSince) {
    state.noDispatchSince = summary.cycleStartedAt;
  } else if (!hadQueuedWorkAtStart) {
    state.noDispatchSince = null;
  }

  summary.stopLoss.counters = buildStopLossCounters(layout, ledger, options, state);
  if (state.noReportCycles >= options.captainNoReportLimit) {
    recordStopLossTrigger(
      layout,
      ledger,
      options,
      summary,
      state,
      'captain-no-reports',
      `Captain received no report cards for ${state.noReportCycles} consecutive cycle(s).`
    );
    return;
  }

  const noDispatchMinutes = elapsedMinutesSince(state.noDispatchSince);
  if (noDispatchMinutes !== null && noDispatchMinutes >= options.captainNoDispatchMinutes) {
    recordStopLossTrigger(
      layout,
      ledger,
      options,
      summary,
      state,
      'captain-no-dispatch-timeout',
      `Captain had queued dispatch work for ${noDispatchMinutes} minute(s) without sending a dispatch card.`
    );
  }
}

export function evaluateWorkerStopLoss(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  if (!options.agentId) {
    return;
  }
  const state = ledger.stopLoss.workers[options.agentId];
  const activeDispatches = getWorkerActiveDispatches(layout, ledger, options.agentId);
  const completedThisWorker = summary.completed.some((entry) => entry.agentId === options.agentId);
  const claimedThisWorker = summary.claimed.some((entry) => entry.agentId === options.agentId);
  const idleThisWorker = summary.idleAgents.includes(options.agentId);

  summary.stopLoss.activeDispatches = activeDispatches;

  if (completedThisWorker) {
    state.noDispatchCycles = 0;
    state.activeSince = null;
  } else if (claimedThisWorker || activeDispatches.length > 0) {
    state.noDispatchCycles = 0;
    state.activeSince = state.activeSince || activeDispatches[0]?.since || summary.cycleStartedAt;
  } else if (idleThisWorker) {
    state.noDispatchCycles += 1;
    state.activeSince = null;
  }

  summary.stopLoss.counters = buildStopLossCounters(layout, ledger, options, state);
  if (state.noDispatchCycles >= options.workerNoDispatchLimit) {
    recordStopLossTrigger(
      layout,
      ledger,
      options,
      summary,
      state,
      'worker-no-dispatches',
      `Worker ${options.agentId} received no dispatch cards for ${state.noDispatchCycles} consecutive cycle(s).`
    );
    return;
  }

  const activeMinutes = elapsedMinutesSince(state.activeSince);
  if (activeDispatches.length > 0 && !completedThisWorker && activeMinutes !== null && activeMinutes >= options.workerNoReportMinutes) {
    recordStopLossTrigger(
      layout,
      ledger,
      options,
      summary,
      state,
      'worker-no-report-timeout',
      `Worker ${options.agentId} has had active work for ${activeMinutes} minute(s) without reporting back to captain.`
    );
  }
}

export function recordStopLossTrigger(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary, state: CaptainStopLossState | WorkerStopLossState, trigger: string, reason: string): void {
  if (summary.stopLoss.shouldStop) {
    return;
  }

  const now = new Date().toISOString();
  state.paused = true;
  state.stoppedAt = now;
  state.lastTrigger = trigger;
  summary.stopLoss.shouldStop = true;
  summary.stopLoss.paused = true;
  summary.stopLoss.trigger = trigger;
  summary.stopLoss.reason = reason;
  summary.stopLoss.counters = buildStopLossCounters(layout, ledger, options, state);
  const reportPath = writeStopLossReport(layout, options, summary, now);
  state.lastStopLossReportPath = reportPath;
  summary.stopLoss.reportPath = reportPath;
}

export function writeStopLossReport(layout: MailboxLayout, options: MailboxOptions, summary: MailboxSummary, generatedAt: string): string {
  const reportDir = options.role === 'worker' && options.agentId
    ? requireAgentLayout(layout, options.agentId).stopLoss
    : layout.captain.stopLoss;
  const fileName = `${generatedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}--${sanitizeFileName(summary.stopLoss.actor)}--${sanitizeFileName(summary.stopLoss.trigger)}.stop-loss.md`;
  const reportPath = uniquePath(path.join(reportDir, fileName));
  const portableReportPath = toPortablePath(reportPath);
  const stopLossForReport = { ...summary.stopLoss, reportPath: portableReportPath };
  const markdown = [
    '---',
    'type: mailbox-stop-loss-report',
    `actor: ${summary.stopLoss.actor}`,
    `automation_id: ${summary.stopLoss.automationId}`,
    `trigger: ${summary.stopLoss.trigger}`,
    `generated_at: ${generatedAt}`,
    '---',
    '',
    '# Mailbox Stop-Loss Report',
    '',
    `Generated: ${generatedAt}`,
    `Actor: ${summary.stopLoss.actor}`,
    `Automation: ${summary.stopLoss.automationId}`,
    `Trigger: ${summary.stopLoss.trigger}`,
    '',
    '## Reason',
    summary.stopLoss.reason,
    '',
    '## Current Events',
    `- Dispatched: ${summary.dispatched.length}`,
    `- Claimed: ${summary.claimed.length}`,
    `- Completed: ${summary.completed.length}`,
    `- Reports received: ${summary.reportsReceived.length}`,
    `- Stale unclaimed: ${summary.staleUnclaimed.length}`,
    `- Errors: ${summary.errors.length}`,
    '',
    '## Current State',
    '```json',
    JSON.stringify({
      stopLoss: stopLossForReport,
      backlog: summary.backlog,
      cycleInputBacklog: summary.cycleInputBacklog,
      activeDispatches: summary.stopLoss.activeDispatches,
      errors: summary.errors
    }, null, 2),
    '```',
    '',
    '## Required Action',
    `Pause automation ${summary.stopLoss.automationId} and keep this report as the handoff reason before resuming.`,
    ''
  ].join('\n');

  writeFileSync(reportPath, markdown, 'utf8');
  return portableReportPath;
}

export function buildStopLossCounters(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, state: CaptainStopLossState | WorkerStopLossState): Record<string, unknown> {
  if (options.role === 'worker' && options.agentId) {
    const workerState = state as WorkerStopLossState;
    const activeDispatches = getWorkerActiveDispatches(layout, ledger, options.agentId);
    return {
      noDispatchCycles: workerState.noDispatchCycles,
      noDispatchLimit: options.workerNoDispatchLimit,
      activeSince: workerState.activeSince,
      activeMinutes: elapsedMinutesSince(workerState.activeSince),
      noReportMinutesLimit: options.workerNoReportMinutes,
      activeDispatchCount: activeDispatches.length
    };
  }

  const captainState = state as CaptainStopLossState;
  return {
    noReportCycles: captainState.noReportCycles,
    noReportLimit: options.captainNoReportLimit,
    noDispatchSince: captainState.noDispatchSince,
    noDispatchMinutes: elapsedMinutesSince(captainState.noDispatchSince),
    noDispatchMinutesLimit: options.captainNoDispatchMinutes
  };
}

export function getWorkerActiveDispatches(layout: MailboxLayout, ledger: Ledger, agentId: string): MailboxSummary['stopLoss']['activeDispatches'] {
  const agentLayout = layout.agents.get(agentId);
  if (!agentLayout) {
    return [];
  }

  return listFiles(agentLayout.active, ['.md']).map((filePath) => {
    const dispatch = parseMarkdownFile(filePath);
    const dispatchId = resolveDispatchId(dispatch.frontMatter, path.basename(filePath, '.md'));
    const ledgerDispatch = ledger.dispatches[dispatchId] || {};
    const since = ledgerDispatch.claimedAt || new Date(statSync(filePath).mtimeMs).toISOString();
    return {
      dispatchId,
      path: toPortablePath(filePath),
      since,
      ageMinutes: elapsedMinutesSince(since)
    };
  }).sort((left, right) => Date.parse(left.since) - Date.parse(right.since));
}

export function elapsedMinutesSince(isoTimestamp: string | null): number | null {
  if (!isoTimestamp) {
    return null;
  }
  const timestampMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  return Number(Math.max(0, (Date.now() - timestampMs) / 60000).toFixed(2));
}
