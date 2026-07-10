import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import type {
  AgentBacklog,
  AgentRef,
  BacklogSnapshot,
  Ledger,
  MailboxLayout,
  MailboxOptions,
  MailboxSummary,
  QueueJob
} from './types.ts';
import { requireAgentLayout } from './layout.ts';
import {
  ensureDispatchBody,
  ensureReportBody,
  escapeFrontMatterValue,
  extractFrontMatter,
  fmString,
  isThinReportBody,
  loadWorkerReportFile,
  normalizeOptionalString,
  parseMarkdownFile,
  quoteYamlValue,
  resolveDispatchId,
  sanitizeFrontMatterBlock
} from './frontmatter.ts';
import {
  formatTimestampTag,
  listFiles,
  sanitizeFileName,
  toPortablePath,
  uniquePath
} from './fs-utils.ts';

export { formatTimestampTag, listFiles, sanitizeFileName, toPortablePath, uniquePath } from './fs-utils.ts';
export {
  ensureDispatchBody,
  ensureReportBody,
  isThinReportBody,
  loadWorkerReportFile
} from './frontmatter.ts';

export function computeBacklog(layout: MailboxLayout, options: MailboxOptions): BacklogSnapshot {
  const agents: Record<string, AgentBacklog> = {};
  for (const agent of options.agents) {
    const agentLayout = requireAgentLayout(layout, agent.id);
    agents[agent.id] = {
      inbox: listFiles(agentLayout.inbox, ['.md']).length,
      active: listFiles(agentLayout.active, ['.md']).length,
      done: listFiles(agentLayout.done, ['.md']).length,
      reports: listFiles(agentLayout.reports, ['.md']).length
    };
  }

  return {
    captain: {
      queue: listFiles(layout.captain.queue, ['.json', '.md']).length,
      inbox: listFiles(layout.captain.inbox, ['.md']).length,
      outbox: listFiles(layout.captain.outbox, ['.md']).length,
      reports: listFiles(layout.captain.reports, ['.md']).length
    },
    agents
  };
}

export function writeCaptainHandoff(layout: MailboxLayout, ledger: Ledger, summary: MailboxSummary): string {
  const handoffPath = path.join(layout.captain.handoff, 'latest-handoff.md');
  const activeDispatches = Object.values(ledger.dispatches)
    .filter((dispatch) => !['done'].includes(dispatch.status || ''))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  const markdown = [
    '# Captain Mailbox Handoff',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Mailbox root: ${summary.root}`,
    `Captain model: ${summary.captain.model}`,
    '',
    '## Dispatch Compliance',
    '- Skill used: atm-dispatch',
    '- Delegation mode: captain control thread with opted-in worker thread handoff',
    '- Internal sidecar remains the default for review, preflight, grep, checklist, planning-only checks, and post-report verification.',
    '- External write remains forbidden unless the dispatch card grants explicit write authority and scope.',
    '',
    '## Last Cycle',
    `- Dispatched: ${summary.dispatched.length}`,
    `- Claimed: ${summary.claimed.length}`,
    `- Completed: ${summary.completed.length}`,
    `- Reports received: ${summary.reportsReceived.length}`,
    `- Stale unclaimed: ${summary.staleUnclaimed.length}`,
    `- Ready for next cycle: ${summary.readyForNextCycle}`,
    `- Stop-loss paused: ${summary.stopLoss.paused}`,
    `- Stop-loss trigger: ${summary.stopLoss.trigger || 'None'}`,
    `- Stop-loss report: ${summary.stopLoss.reportPath || 'None'}`,
    '',
    '## Active Dispatches',
    ...(activeDispatches.length === 0
      ? ['- None']
      : activeDispatches.map((dispatch) => `- ${dispatch.id}: ${dispatch.status} -> ${dispatch.assignee}`)),
    '',
    '## Backlog Snapshot',
    '```json',
    JSON.stringify(summary.backlog, null, 2),
    '```',
    '',
    '## Stop-Loss Snapshot',
    '```json',
    JSON.stringify(summary.stopLoss, null, 2),
    '```',
    '',
    '## Next Captain Instructions',
    '1. Read this handoff first.',
    '2. Continue with `node scripts/captain-dispatch-mailbox.mjs --role captain --json` using the same mailbox root and agents.',
    '3. Keep decision output in Captain Decision Packet format.',
    ''
  ].join('\n');

  writeFileSync(handoffPath, markdown, 'utf8');
  return toPortablePath(handoffPath);
}

export function writeWorkerHandoff(layout: MailboxLayout, options: MailboxOptions, summary: MailboxSummary): string | null {
  if (!options.agentId) {
    return null;
  }
  const agentLayout = requireAgentLayout(layout, options.agentId);

  const handoffPath = path.join(agentLayout.handoff, 'latest-handoff.md');
  const markdown = [
    `# Worker ${options.agentId} Handoff`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Mailbox root: ${summary.root}`,
    `Worker model: ${options.agents.find((agent) => agent.id === options.agentId)?.model || options.workerModel}`,
    '',
    '## Last Cycle',
    `- Claimed: ${summary.claimed.length}`,
    `- Completed: ${summary.completed.length}`,
    `- Active: ${summary.backlog?.agents?.[options.agentId]?.active ?? 0}`,
    `- Inbox: ${summary.backlog?.agents?.[options.agentId]?.inbox ?? 0}`,
    `- Stop-loss paused: ${summary.stopLoss.paused}`,
    `- Stop-loss trigger: ${summary.stopLoss.trigger || 'None'}`,
    `- Stop-loss report: ${summary.stopLoss.reportPath || 'None'}`,
    '',
    '## Active Files',
    ...listFiles(agentLayout.active, ['.md']).map((filePath) => `- ${toPortablePath(filePath)}`),
    '',
    '## Stop-Loss Snapshot',
    '```json',
    JSON.stringify(summary.stopLoss, null, 2),
    '```',
    '',
    '## Next Worker Instructions',
    '1. Read any active dispatch before claiming a new one.',
    '2. If active work is complete, follow the active dispatch Report Contract before running worker mode with `--complete-active`.',
    '3. Do not report done with ok/done only; use status=blocked or needs-captain-review if the assigned work was not actually completed.',
    '4. If no active work exists, run worker mode to claim the next inbox dispatch.',
    ''
  ].join('\n');

  writeFileSync(handoffPath, markdown, 'utf8');
  return toPortablePath(handoffPath);
}

export function loadQueueJob(queuePath: string): QueueJob {
  if (path.extname(queuePath).toLowerCase() === '.json') {
    const parsed = JSON.parse(readFileSync(queuePath, 'utf8'));
    return normalizeJob({
      ...parsed,
      sourceKind: 'json',
      sourceFrontMatterRaw: null
    }, queuePath);
  }

  const parsed = parseMarkdownFile(queuePath);
  return normalizeJob({
    ...parsed.frontMatter,
    title: normalizeOptionalString(parsed.frontMatter.title) || parsed.heading || path.basename(queuePath, path.extname(queuePath)),
    objective: normalizeOptionalString(parsed.frontMatter.objective) || parsed.body.trim(),
    sourceBody: parsed.body.trim(),
    sourceKind: 'markdown',
    sourceFrontMatterRaw: parsed.rawFrontMatter
  }, queuePath);
}

export function normalizeJob(raw: Record<string, unknown>, queuePath: string): QueueJob {
  const id = normalizeOptionalString(raw.task_id || raw.taskId || raw.id || raw.job_id)
    || path.basename(queuePath, path.extname(queuePath));
  const title = normalizeOptionalString(raw.title) || id;
  const scope = normalizeStringList(raw.scopePaths ?? raw.scope_paths ?? raw.allowedFiles ?? raw.allowed_files ?? raw.scope, ['Mailbox-only dispatch cycle']);
  const validators = normalizeStringList(raw.validators, ['Return a Markdown report to captain/inbox']);
  const deliverables = normalizeStringList(raw.deliverables, scope);
  const outOfScope = normalizeStringList(raw.outOfScope ?? raw.out_of_scope, []);
  const dependsOn = normalizeStringList(raw.depends_on ?? raw.dependsOn, []);
  return {
    id,
    title,
    sourceKind: normalizeOptionalString(raw.sourceKind) || 'json',
    sourceFrontMatterRaw: normalizeOptionalString(raw.sourceFrontMatterRaw),
    assignee: raw.assignee ? String(raw.assignee) : null,
    objective: String(raw.objective || raw.goal || title),
    status: String(raw.status || 'assigned'),
    owner: String(raw.owner || raw.assignee || 'atm-release'),
    priority: String(raw.priority || 'P1'),
    dependsOn,
    relatedPlan: raw.related_plan || raw.relatedPlan ? String(raw.related_plan || raw.relatedPlan) : null,
    planningRepo: String(raw.planning_repo || raw.planningRepo || 'AI-Atomic-Framework'),
    targetRepo: String(raw.target_repo || raw.targetRepo || 'AI-Atomic-Framework'),
    closureAuthority: String(raw.closure_authority || raw.closureAuthority || 'target_repo'),
    scope,
    deliverables,
    validators,
    evidenceRequired: String(raw.evidence_required || raw.evidenceRequired || (raw.evidence as Record<string, unknown> | undefined)?.required || 'command-backed'),
    rollbackStrategy: String(raw.rollback_strategy || raw.rollbackStrategy || (raw.rollback as Record<string, unknown> | undefined)?.strategy || 'revert-commit'),
    atomizationOwner: raw.atomization_owner || raw.atomizationOwner || (raw.atomizationImpact as Record<string, unknown> | undefined)?.ownerAtomOrMap
      ? String(raw.atomization_owner || raw.atomizationOwner || (raw.atomizationImpact as Record<string, unknown> | undefined)?.ownerAtomOrMap)
      : 'mailbox-dispatch-runtime',
    atomizationMapUpdates: normalizeStringList(raw.mapUpdates ?? raw.map_updates ?? (raw.atomizationImpact as Record<string, unknown> | undefined)?.mapUpdates, []),
    workModel: raw.work_model || raw.workModel ? String(raw.work_model || raw.workModel) : null,
    outOfScope,
    sourceBody: raw.sourceBody ? String(raw.sourceBody).trim() : null
  };
}

export function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry).trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }
  if (typeof value === 'string') {
    const normalized = value.split(/\r?\n|,/)
      .map((entry) => entry.replace(/^-\s*/, '').trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }
  return fallback;
}

export function resolveAssignee(job: QueueJob, agents: AgentRef[], layout: MailboxLayout): AgentRef | null {
  if (job.assignee) {
    return agents.find((agent) => agent.id === job.assignee) || null;
  }

  return [...agents].sort((left, right) => {
    const leftLayout = requireAgentLayout(layout, left.id);
    const rightLayout = requireAgentLayout(layout, right.id);
    const leftLoad = listFiles(leftLayout.inbox, ['.md']).length + listFiles(leftLayout.active, ['.md']).length;
    const rightLoad = listFiles(rightLayout.inbox, ['.md']).length + listFiles(rightLayout.active, ['.md']).length;
    return leftLoad - rightLoad || left.id.localeCompare(right.id);
  })[0];
}

export function createDispatchId(job: QueueJob, agent: AgentRef, isoTimestamp: string): string {
  const stamp = formatTimestampTag(isoTimestamp);
  return `${sanitizeFileName(job.id)}--captain-to-${sanitizeFileName(agent.id)}--${stamp}`;
}

export function renderDispatchMarkdown({ dispatchId, job, agent, captainModel, createdAt }: { dispatchId: string; job: QueueJob; agent: AgentRef; captainModel: string; createdAt: string }): string {
  if (job.sourceKind === 'markdown' && job.sourceFrontMatterRaw) {
    const body = ensureDispatchBody(job.sourceBody, {
      taskId: job.id,
      dispatchId,
      fromAgent: 'captain',
      toAgent: agent.id,
      workModel: job.workModel || agent.model
    });
    const preservedFrontMatter = sanitizeFrontMatterBlock(job.sourceFrontMatterRaw, new Set([
      'type',
      'dispatch_id',
      'source_job_id',
      'assignee',
      'assignee_model',
      'captain_model',
      'work_model',
      'from_agent',
      'to_agent',
      'reply_to',
      'mailbox_created_at'
    ]));
    return finalizeDispatchMarkdown([
      '---',
      ...(preservedFrontMatter ? [preservedFrontMatter] : []),
      `type: ${quoteYamlValue('captain-dispatch')}`,
      `dispatch_id: ${quoteYamlValue(dispatchId)}`,
      `source_job_id: ${quoteYamlValue(job.id)}`,
      `assignee: ${quoteYamlValue(agent.id)}`,
      `assignee_model: ${quoteYamlValue(agent.model)}`,
      `captain_model: ${quoteYamlValue(captainModel)}`,
      `work_model: ${quoteYamlValue(job.workModel || agent.model)}`,
      `from_agent: ${quoteYamlValue('captain')}`,
      `to_agent: ${quoteYamlValue(agent.id)}`,
      `reply_to: ${quoteYamlValue('captain')}`,
      `mailbox_created_at: ${quoteYamlValue(createdAt)}`,
      '---',
      '',
      body,
      ''
    ].join('\n'), { fromAgent: 'captain', toAgent: agent.id, taskId: job.id, dispatchId });
  }

  const originalBody = job.sourceBody && job.sourceBody !== job.objective ? job.sourceBody : null;
  return finalizeDispatchMarkdown([
    '---',
    'type: captain-dispatch',
    `dispatch_id: ${quoteYamlValue(dispatchId)}`,
    `source_job_id: ${quoteYamlValue(job.id)}`,
    `task_id: ${quoteYamlValue(job.id)}`,
    `assignee: ${quoteYamlValue(agent.id)}`,
    `assignee_model: ${quoteYamlValue(agent.model)}`,
    `work_model: ${quoteYamlValue(job.workModel || agent.model)}`,
    `captain_model: ${quoteYamlValue(captainModel)}`,
    `from_agent: ${quoteYamlValue('captain')}`,
    `to_agent: ${quoteYamlValue(agent.id)}`,
    `reply_to: ${quoteYamlValue('captain')}`,
    `status: ${quoteYamlValue(job.status)}`,
    `owner: ${quoteYamlValue(job.owner)}`,
    `priority: ${quoteYamlValue(job.priority)}`,
    'depends_on:',
    ...renderYamlList(job.dependsOn),
    ...(job.relatedPlan ? [`related_plan: ${quoteYamlValue(job.relatedPlan)}`] : []),
    `planning_repo: ${quoteYamlValue(job.planningRepo)}`,
    `target_repo: ${quoteYamlValue(job.targetRepo)}`,
    `closure_authority: ${quoteYamlValue(job.closureAuthority)}`,
    'scopePaths:',
    ...renderYamlList(job.scope),
    'deliverables:',
    ...renderYamlList(job.deliverables),
    'validators:',
    ...renderYamlList(job.validators),
    'evidence:',
    `  required: ${quoteYamlValue(job.evidenceRequired)}`,
    'rollback:',
    `  strategy: ${quoteYamlValue(job.rollbackStrategy)}`,
    'atomizationImpact:',
    `  ownerAtomOrMap: ${quoteYamlValue(job.atomizationOwner)}`,
    '  mapUpdates:',
    ...renderYamlList(job.atomizationMapUpdates, '    '),
    `created_at: ${quoteYamlValue(createdAt)}`,
    `reply_to_mailbox: ${quoteYamlValue('captain/inbox')}`,
    `title: ${quoteYamlValue(job.title)}`,
    '---',
    '',
    `派工方代號：captain；接收方代號：${agent.id}；任務：${job.id}`,
    '',
    `# ${job.title}`,
    '',
    '## Dispatch Compliance',
    '- Skill used: atm-dispatch',
    '- Delegation mode: external handoff worker thread, explicitly opted in by the user for this mailbox system.',
    '- External write is forbidden unless this card explicitly grants write authority and scope.',
    '- This is an ATM standard task-card dispatch. Do not replace it with a free-form checklist.',
    '',
    '## Model Policy',
    `- Intake / mailbox polling model: ${agent.model}`,
    `- Work execution model: ${job.workModel || agent.model}`,
    '- If work_model is higher than the intake model, the intake worker should hand off execution to a worker execution thread with that model instead of doing substantial work in the polling thread.',
    '- Keep token use low: read this dispatch card, the worker handoff, and only the scoped files needed for the assigned work.',
    '',
    '## Objective',
    job.objective,
    '',
    '## Context Map',
    '### Primary',
    ...renderMarkdownList(job.scope),
    '',
    '### Secondary',
    ...renderMarkdownList(job.outOfScope.length > 0 ? job.outOfScope : ['No extra files or repos are allowed unless the captain amends this dispatch.']),
    '',
    '### Test Coverage',
    ...renderMarkdownList(job.validators),
    '',
    '### Patterns to Follow',
    '- Follow existing repository patterns and the active ATM task-card contract.',
    '- If scope is unclear, report blocked instead of guessing.',
    '',
    '## Scope Paths',
    ...renderMarkdownList(job.scope),
    '',
    '## Deliverables',
    ...renderMarkdownList(job.deliverables),
    '',
    '## Out Of Scope / Forbidden',
    ...renderMarkdownList(job.outOfScope.length > 0
      ? job.outOfScope
      : [
          'Do not edit files outside scopePaths/deliverables.',
          'Do not hand-edit .atm/runtime/** or .atm/history/**.',
          'Do not report done without real deliverables and validation evidence.'
        ]),
    '',
    '## Validators',
    ...renderMarkdownList(job.validators),
    '',
    '## Completion Gate',
    '- A report that only says ok, done, completed, or mailbox lifecycle completed is invalid.',
    '- If the requested work was not actually performed, return status=blocked or needs-captain-review instead of status=done.',
    '- Before status=done, run the validators or explain exactly why a validator could not be run.',
    '- Include command-backed evidence when the task asks for command-backed evidence.',
    '',
    '## Report Contract',
    `Return a Markdown report to captain/inbox with dispatch_id=${dispatchId}, from_agent=${agent.id}, to_agent=captain, and status matching the result.`,
    '',
    'The report body must follow any more specific report format written in this dispatch card. If no stricter format is present, include: work performed, commands run, files/artifacts touched, validator results, blockers/residual risk, and next recommendation.',
    ...(originalBody
      ? [
          '',
          '## Original Captain Task Card Body',
          '',
          originalBody
        ]
      : []),
    ''
  ].join('\n'), { fromAgent: 'captain', toAgent: agent.id, taskId: job.id, dispatchId });
}

export function renderYamlList(items: string[] | null | undefined, indent = '  '): string[] {
  if (!items || items.length === 0) {
    return [`${indent}- none`];
  }
  return items.map((item) => `${indent}- ${quoteYamlValue(item)}`);
}

export function renderMarkdownList(items: string[] | null | undefined): string[] {
  if (!items || items.length === 0) {
    return ['- None'];
  }
  return items.map((item) => `- ${item}`);
}

export function buildDispatchFileName(taskId: string, fromAgent: string, toAgent: string, isoTimestamp: string): string {
  return `${sanitizeFileName(taskId)}--${sanitizeFileName(fromAgent)}-to-${sanitizeFileName(toAgent)}--${formatTimestampTag(isoTimestamp)}.dispatch.md`;
}

export function buildArchiveFileName(taskId: string, fromAgent: string, toAgent: string, isoTimestamp: string, extension = '.md'): string {
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  return `${sanitizeFileName(taskId)}--${sanitizeFileName(fromAgent)}-to-${sanitizeFileName(toAgent)}--${formatTimestampTag(isoTimestamp)}.queue${normalizedExtension}`;
}

export function buildReportFileName(taskId: string, fromAgent: string, toAgent: string, isoTimestamp: string): string {
  return `${sanitizeFileName(taskId)}--${sanitizeFileName(fromAgent)}-to-${sanitizeFileName(toAgent)}--${formatTimestampTag(isoTimestamp)}.report.md`;
}

export function finalizeDispatchMarkdown(markdown: string, options: { fromAgent: string; toAgent: string; taskId: string; dispatchId: string }): string {
  const lines = String(markdown || '').split('\n');
  let inFrontMatter = false;
  let frontMatterBoundaries = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      frontMatterBoundaries += 1;
      inFrontMatter = frontMatterBoundaries === 1;
      continue;
    }
    if (frontMatterBoundaries < 2) {
      continue;
    }
    if (lines[index].trim().length === 0) {
      continue;
    }
    lines[index] = `Dispatch: ${options.fromAgent} -> ${options.toAgent} | Task: ${options.taskId} | Dispatch: ${options.dispatchId}`;
    break;
  }

  return lines.join('\n');
}

export function buildDecisionBasis(summary: MailboxSummary, options: MailboxOptions): string[] {
  const basis: string[] = [];
  if (summary.stopLoss.shouldStop) {
    basis.push(`Stop-loss triggered for ${summary.stopLoss.actor}: ${summary.stopLoss.reason}`);
  } else if (summary.stopLoss.cleared && summary.stopLoss.reason) {
    basis.push(summary.stopLoss.reason);
  } else if (summary.stopLoss.paused) {
    basis.push(`${summary.stopLoss.actor} is paused by stop-loss; no mailbox work was processed.`);
  }

  if (options.role === 'captain' || options.role === 'all') {
    if (summary.seededDemoJobs.length > 0) {
      basis.push(`Seeded ${summary.seededDemoJobs.length} demo job(s) because --seed-demo was requested and the queue was empty.`);
    }
    if (summary.dispatched.length > 0) {
      basis.push(`Dispatched ${summary.dispatched.length} queued job(s) according to assignee metadata or lowest visible mailbox load.`);
    }
    if (summary.reportsReceived.length > 0) {
      basis.push(`Archived ${summary.reportsReceived.length} returned report(s) from captain/inbox.`);
    }
    if (summary.dispatched.length === 0 && summary.reportsReceived.length === 0) {
      basis.push('No queued captain work or returned reports were present, so the captain cycle stayed idle.');
    }
    if (summary.staleUnclaimed.length > 0) {
      basis.push(`Detected ${summary.staleUnclaimed.length} stale unclaimed dispatch(es) for captain review.`);
    }
  }

  if (options.role === 'worker') {
    if (summary.completed.length > 0) {
      basis.push(`Worker ${options.agentId} completed active dispatch and sent a report to captain/inbox.`);
    } else if (summary.claimed.length > 0) {
      basis.push(`Worker ${options.agentId} claimed the next inbox dispatch because it had no active work.`);
    } else if (summary.busyAgents.length > 0) {
      basis.push(`Worker ${options.agentId} already has active work, so it did not claim another dispatch.`);
    } else if (options.agentId && summary.idleAgents.includes(options.agentId)) {
      basis.push(`Worker ${options.agentId} inbox was empty and it had no active work.`);
    }
  }

  if (summary.errors.length > 0) {
    basis.push(`Encountered ${summary.errors.length} error(s); review errors before continuing.`);
  }

  return basis;
}

export function chooseNextAction(summary: MailboxSummary, options: MailboxOptions): string {
  if (summary.stopLoss.shouldStop || summary.stopLoss.paused) {
    return 'pause-automation-stop-loss';
  }
  if (summary.errors.length > 0) {
    return 'review-errors';
  }
  if (summary.staleUnclaimed.length > 0) {
    return 'captain-review-stale-dispatches';
  }
  if (options.role === 'worker' && summary.claimed.length > 0 && summary.completed.length === 0) {
    return 'worker-process-active-dispatch';
  }
  if (summary.readyForNextCycle) {
    return 'wait-for-next-cycle';
  }
  return 'continue-polling';
}

export function emitSummary(summary: MailboxSummary, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Captain mailbox cycle: ${summary.ok ? 'ok' : 'needs attention'}`);
  console.log(`Root: ${summary.root}`);
  console.log(`Dispatched: ${summary.dispatched.length}`);
  console.log(`Claimed: ${summary.claimed.length}`);
  console.log(`Completed: ${summary.completed.length}`);
  console.log(`Reports received: ${summary.reportsReceived.length}`);
  console.log(`Stale unclaimed: ${summary.staleUnclaimed.length}`);
  console.log(`Stop-loss: ${summary.stopLoss.shouldStop ? `${summary.stopLoss.trigger} (${summary.stopLoss.reportPath})` : 'not triggered'}`);
  if (summary.errors.length > 0) {
    console.log('Errors:');
    for (const error of summary.errors) {
      console.log(`- ${error}`);
    }
  }
}

export function createSummary(root: string, options: MailboxOptions): MailboxSummary {
  return {
    ok: true,
    root: toPortablePath(root),
    cycleStartedAt: new Date().toISOString(),
    captain: { id: 'captain', model: options.captainModel },
    agents: options.agents,
    role: options.role,
    decisionPacket: {
      skillUsed: 'atm-dispatch',
      delegationMode: options.role === 'worker' ? 'external handoff worker thread' : 'captain control thread',
      basis: [],
      nextAction: null
    },
    seededDemoJobs: [],
    cycleInputBacklog: null,
    dispatched: [],
    claimed: [],
    completed: [],
    reportsReceived: [],
    idleAgents: [],
    busyAgents: [],
    staleUnclaimed: [],
    backlog: null,
    stopLoss: {
      shouldStop: false,
      paused: false,
      cleared: false,
      actor: options.role === 'worker' ? `worker-${options.agentId}` : 'captain',
      automationId: options.role === 'worker' ? `mailbox-worker-${options.agentId}-polling` : 'captain-mailbox-polling',
      trigger: null,
      reason: null,
      reportPath: null,
      thresholds: {
        captainNoReportLimit: options.captainNoReportLimit,
        captainNoDispatchMinutes: options.captainNoDispatchMinutes,
        workerNoDispatchLimit: options.workerNoDispatchLimit,
        workerNoReportMinutes: options.workerNoReportMinutes
      },
      counters: {},
      activeDispatches: []
    },
    handoffPath: null,
    readyForNextCycle: false,
    errors: []
  };
}
