import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import type { Ledger, MailboxLayout, MailboxSummary } from '../types.ts';
import {
  buildReportFileName,
  formatTimestampTag,
  listFiles,
  sanitizeFileName,
  toPortablePath,
  uniquePath
} from '../render.ts';
import { fmString, normalizeOptionalString, parseMarkdownFile, resolveDispatchId } from '../frontmatter.ts';

export function receiveCaptainReports(layout: MailboxLayout, ledger: Ledger, summary: MailboxSummary, phase: string): void {
  for (const reportPath of listFiles(layout.captain.inbox, ['.md'])) {
    const report = parseMarkdownFile(reportPath);
    const dispatchId = resolveDispatchId(report.frontMatter, path.basename(reportPath, '.md'));
    const agentId = fmString(report.frontMatter, 'agent', 'assignee') || 'unknown';
    const taskId = normalizeOptionalString(fmString(report.frontMatter, 'task_id', 'source_job_id')) || dispatchId;
    const fromAgent = normalizeOptionalString(fmString(report.frontMatter, 'from_agent', 'agent')) || agentId;
    const toAgent = normalizeOptionalString(fmString(report.frontMatter, 'to_agent', 'reply_to')) || 'captain';
    const completedAt = normalizeOptionalString(fmString(report.frontMatter, 'completed_at'))
      || new Date(statSync(reportPath).mtimeMs).toISOString();
    const archivePath = uniquePath(path.join(
      layout.captain.reports,
      buildReportFileName(taskId, fromAgent, toAgent, completedAt)
    ));

    renameSync(reportPath, archivePath);
    if (dispatchId && ledger.dispatches[dispatchId]) {
      ledger.dispatches[dispatchId] = {
        ...ledger.dispatches[dispatchId],
        status: 'done',
        completedAt: new Date().toISOString(),
        reportPath: toPortablePath(archivePath)
      };
    }

    summary.reportsReceived.push({
      phase,
      dispatchId,
      agentId,
      reportPath: toPortablePath(archivePath)
    });
  }
}

export function isThinDoneReport(status: string, summary: string | null): boolean {
  if (String(status).toLowerCase() !== 'done') {
    return false;
  }
  const normalized = String(summary || '').trim().toLowerCase();
  return normalized.length < 20 || ['ok', 'okay', 'done', 'completed', 'pass'].includes(normalized);
}
