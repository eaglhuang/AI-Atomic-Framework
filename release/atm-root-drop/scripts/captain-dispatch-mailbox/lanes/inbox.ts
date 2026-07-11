import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import type { Ledger, MailboxLayout, MailboxOptions, MailboxSummary } from '../types.ts';
import { requireAgentLayout } from '../layout.ts';
import {
  buildArchiveFileName,
  buildDispatchFileName,
  createDispatchId,
  finalizeDispatchMarkdown,
  formatTimestampTag,
  listFiles,
  loadQueueJob,
  renderDispatchMarkdown,
  resolveAssignee,
  sanitizeFileName,
  toPortablePath,
  uniquePath
} from '../render.ts';
import { parseMarkdownFile, resolveDispatchId } from '../frontmatter.ts';

export function seedDemoQueue(layout: MailboxLayout): string[] {
  const existing = listFiles(layout.captain.queue);
  if (existing.length > 0) {
    return [];
  }

  const demoJobs = [
    {
      id: 'DEMO-JOB-001',
      title: 'Verify mailbox directory contract',
      assignee: '001',
      objective: 'Confirm the captain and worker mailbox folders are readable, writable, and ready for the next polling cycle.',
      scope: ['Mailbox root only', 'No repository source edits'],
      validators: ['Report final status and any missing folders']
    },
    {
      id: 'DEMO-JOB-002',
      title: 'Verify report return contract',
      assignee: '002',
      objective: 'Confirm an agent can receive a dispatch card and return a Markdown report to the captain inbox.',
      scope: ['Mailbox root only', 'No repository source edits'],
      validators: ['Report dispatch id, agent id, and completion status']
    }
  ];

  for (const job of demoJobs) {
    const filePath = path.join(layout.captain.queue, `${job.id}.json`);
    writeFileSync(filePath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  }

  return demoJobs.map((job) => job.id);
}

export function dispatchQueuedWork(layout: MailboxLayout, ledger: Ledger, options: MailboxOptions, summary: MailboxSummary): void {
  const queueFiles = listFiles(layout.captain.queue, ['.json', '.md']).slice(0, options.maxDispatch);
  for (const queuePath of queueFiles) {
    const job = loadQueueJob(queuePath);
    const agent = resolveAssignee(job, options.agents, layout);
    if (!agent) {
      summary.errors.push(`No available assignee for ${queuePath}`);
      continue;
    }

    const now = new Date().toISOString();
    const dispatchId = createDispatchId(job, agent, now);
    const dispatchFileName = buildDispatchFileName(job.id, 'captain', agent.id, now);
    const outboxPath = path.join(layout.captain.outbox, dispatchFileName);
    const agentInboxPath = path.join(requireAgentLayout(layout, agent.id).inbox, dispatchFileName);
    const markdown = renderDispatchMarkdown({
      dispatchId,
      job,
      agent,
      captainModel: options.captainModel,
      createdAt: now
    });

    writeFileSync(outboxPath, markdown, 'utf8');
    copyFileSync(outboxPath, uniquePath(agentInboxPath));

    const archivedQueuePath = uniquePath(path.join(
      layout.captain.archive,
      buildArchiveFileName(job.id, 'captain', agent.id, now, path.extname(queuePath) || '.md')
    ));
    renameSync(queuePath, archivedQueuePath);

    ledger.dispatches[dispatchId] = {
      id: dispatchId,
      sourceJobId: job.id,
      title: job.title,
      assignee: agent.id,
      assigneeModel: agent.model,
      captainModel: options.captainModel,
      status: 'sent',
      createdAt: now,
      outboxPath: toPortablePath(outboxPath),
      agentInboxPath: toPortablePath(agentInboxPath),
      archivedQueuePath: toPortablePath(archivedQueuePath)
    };

    summary.dispatched.push({
      dispatchId,
      assignee: agent.id,
      assigneeModel: agent.model,
      title: job.title
    });
  }
}

export function scanUnclaimed(layout: MailboxLayout, options: MailboxOptions): MailboxSummary['staleUnclaimed'] {
  const staleMs = options.staleMinutes * 60 * 1000;
  const now = Date.now();
  const stale: MailboxSummary['staleUnclaimed'] = [];
  for (const agent of options.agents) {
    const agentLayout = requireAgentLayout(layout, agent.id);
    for (const filePath of listFiles(agentLayout.inbox, ['.md'])) {
      const ageMs = now - statSync(filePath).mtimeMs;
      if (ageMs >= staleMs) {
        const parsed = parseMarkdownFile(filePath);
        stale.push({
          agentId: agent.id,
          dispatchId: resolveDispatchId(parsed.frontMatter, path.basename(filePath, '.md')),
          ageMinutes: Number((ageMs / 60000).toFixed(2)),
          path: toPortablePath(filePath)
        });
      }
    }
  }
  return stale;
}
