import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import type {
  AgentRef,
  AgentLayout,
  Ledger,
  MailboxLayout,
  MailboxOptions,
  MailboxSummary,
  ParsedMarkdown,
  WorkerReportOptions
} from '../types.ts';
import { requireAgentLayout } from '../layout.ts';
import {
  buildReportFileName,
  formatTimestampTag,
  listFiles,
  sanitizeFileName,
  toPortablePath,
  uniquePath
} from '../render.ts';
import {
  ensureDispatchBody,
  ensureReportBody,
  fmString,
  isThinReportBody,
  loadWorkerReportFile,
  normalizeOptionalString,
  parseMarkdownFile,
  quoteYamlValue,
  resolveDispatchId
} from '../frontmatter.ts';
import { isThinDoneReport } from './reports.ts';

export function pollWorkers(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  for (const agent of options.agents) {
    const agentLayout = requireAgentLayout(layout, agent.id);
    const activeFiles = listFiles(agentLayout.active, ['.md']);
    if (activeFiles.length > 0) {
      summary.busyAgents.push({ agentId: agent.id, active: activeFiles.map(toPortablePath) });
      continue;
    }

    const inboxFiles = listFiles(agentLayout.inbox, ['.md']);
    if (inboxFiles.length === 0) {
      summary.idleAgents.push(agent.id);
      continue;
    }

    const inboxPath = inboxFiles[0];
    const dispatch = parseMarkdownFile(inboxPath);
    const dispatchId = resolveDispatchId(dispatch.frontMatter, path.basename(inboxPath, '.md'));
    const activePath = uniquePath(path.join(agentLayout.active, path.basename(inboxPath)));
    renameSync(inboxPath, activePath);

    if (ledger.dispatches[dispatchId]) {
      ledger.dispatches[dispatchId] = {
        ...ledger.dispatches[dispatchId],
        status: 'claimed',
        claimedAt: new Date().toISOString(),
        activePath: toPortablePath(activePath)
      };
    }

    summary.claimed.push({ dispatchId, agentId: agent.id, activePath: toPortablePath(activePath) });

    if (options.simulateWorkers) {
      completeSimulatedWorker(layout, ledger, agent, agentLayout, activePath, dispatch, dispatchId, summary);
    }
  }
}

export function pollOneWorker(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  const agent = options.agents.find((entry) => entry.id === options.agentId);
  if (!agent) {
    throw new Error(`Unknown worker agent: ${options.agentId}`);
  }

  const agentLayout = requireAgentLayout(layout, agent.id);
  const activeFiles = listFiles(agentLayout.active, ['.md']);
  if (options.completeActive) {
    if (activeFiles.length === 0) {
      summary.errors.push(`No active dispatch to complete for worker ${agent.id}`);
      return;
    }
    const activePath = activeFiles[0];
    const dispatch = parseMarkdownFile(activePath);
    const dispatchId = resolveDispatchId(dispatch.frontMatter, path.basename(activePath, '.md'));
    let explicitReport: { status: string; markdown: string } | { error: string } | null = null;
    if (options.reportFile) {
      explicitReport = loadWorkerReportFile(options.reportFile, {
        dispatchId,
        taskId: normalizeOptionalString(fmString(dispatch.frontMatter, 'task_id', 'source_job_id')) || dispatchId,
        fromAgent: agent.id,
        toAgent: normalizeOptionalString(fmString(dispatch.frontMatter, 'reply_to')) || 'captain',
        agentModel: agent.model,
        defaultStatus: options.reportStatus
      });
      if ('error' in explicitReport) {
        summary.errors.push(explicitReport.error);
        return;
      }
    } else if (isThinDoneReport(options.reportStatus, options.reportSummary)) {
      summary.errors.push(`Worker ${agent.id} done report is too thin; follow the active dispatch Report Contract instead of returning ok/done only.`);
      return;
    }
    completeSimulatedWorker(layout, ledger, agent, agentLayout, activePath, dispatch, dispatchId, summary, {
      status: explicitReport?.status || options.reportStatus,
      summary: explicitReport ? null : (options.reportSummary || `Worker ${agent.id} completed the active dispatch.`),
      evidence: explicitReport ? [] : options.reportEvidence,
      reportMarkdown: explicitReport?.markdown
    });
    return;
  }

  if (activeFiles.length > 0) {
    summary.busyAgents.push({ agentId: agent.id, active: activeFiles.map(toPortablePath) });
    return;
  }

  const inboxFiles = listFiles(agentLayout.inbox, ['.md']);
  if (inboxFiles.length === 0) {
    summary.idleAgents.push(agent.id);
    return;
  }

  const inboxPath = inboxFiles[0];
  const dispatch = parseMarkdownFile(inboxPath);
  const dispatchId = resolveDispatchId(dispatch.frontMatter, path.basename(inboxPath, '.md'));
  const activePath = uniquePath(path.join(agentLayout.active, path.basename(inboxPath)));
  renameSync(inboxPath, activePath);

  if (ledger.dispatches[dispatchId]) {
    ledger.dispatches[dispatchId] = {
      ...ledger.dispatches[dispatchId],
      status: 'claimed',
      claimedAt: new Date().toISOString(),
      activePath: toPortablePath(activePath)
    };
  }

  summary.claimed.push({ dispatchId, agentId: agent.id, activePath: toPortablePath(activePath) });

  if (options.simulateWorkers) {
    completeSimulatedWorker(layout, ledger, agent, agentLayout, activePath, dispatch, dispatchId, summary);
  }
}

export function completeSimulatedWorker(layout: MailboxLayout, ledger: Ledger, agent: AgentRef, agentLayout: AgentLayout, activePath: string, dispatch: ParsedMarkdown, dispatchId: string, summary: MailboxSummary, reportOptions: WorkerReportOptions = {}): void {
  const now = new Date().toISOString();
  const status = reportOptions.status || 'done';
  const evidence = reportOptions.evidence || [
    'Dispatch card was claimed from the agent inbox.',
    'Active card was moved to the agent done folder.',
    'This report was copied to the captain inbox.'
  ];
  const taskId = normalizeOptionalString(fmString(dispatch.frontMatter, 'task_id', 'source_job_id')) || dispatchId;
  const fromAgent = normalizeOptionalString(fmString(dispatch.frontMatter, 'to_agent')) || agent.id;
  const toAgent = normalizeOptionalString(fmString(dispatch.frontMatter, 'reply_to', 'from_agent')) || 'captain';
  const reportFileName = buildReportFileName(taskId, fromAgent, toAgent, now);
  const localReportPath = uniquePath(path.join(agentLayout.reports, reportFileName));
  const captainInboxReportPath = uniquePath(path.join(layout.captain.inbox, reportFileName));
  const title = fmString(dispatch.frontMatter, 'title') || dispatch.heading || dispatchId;
  const bodySummary = reportOptions.summary || `Completed simulated work for "${title}".`;
  const defaultReportBody = ensureReportBody([
    bodySummary,
    ...(evidence.length > 0
      ? [
          '',
          '## Evidence',
          ...evidence.map((entry) => `- ${entry}`)
        ]
      : [])
  ].join('\n'), {
    fromAgent,
    toAgent,
    taskId,
    dispatchId
  });
  const reportMarkdown = reportOptions.reportMarkdown || [
    '---',
    `type: ${quoteYamlValue('captain-dispatch-report')}`,
    `dispatch_id: ${quoteYamlValue(dispatchId)}`,
    `task_id: ${quoteYamlValue(taskId)}`,
    `agent: ${quoteYamlValue(agent.id)}`,
    `agent_model: ${quoteYamlValue(agent.model)}`,
    `from_agent: ${quoteYamlValue(fromAgent)}`,
    `to_agent: ${quoteYamlValue(toAgent)}`,
    `status: ${quoteYamlValue(status)}`,
    `completed_at: ${quoteYamlValue(now)}`,
    '---',
    '',
    defaultReportBody,
    ''
  ].join('\n');

  writeFileSync(localReportPath, reportMarkdown, 'utf8');
  copyFileSync(localReportPath, captainInboxReportPath);

  const donePath = uniquePath(path.join(agentLayout.done, path.basename(activePath)));
  renameSync(activePath, donePath);

  if (ledger.dispatches[dispatchId]) {
    ledger.dispatches[dispatchId] = {
      ...ledger.dispatches[dispatchId],
      status: 'reported',
      reportedAt: now,
      donePath: toPortablePath(donePath),
      agentReportPath: toPortablePath(localReportPath),
      captainInboxReportPath: toPortablePath(captainInboxReportPath)
    };
  }

  summary.completed.push({
    dispatchId,
    agentId: agent.id,
    donePath: toPortablePath(donePath),
    reportPath: toPortablePath(captainInboxReportPath)
  });
}
