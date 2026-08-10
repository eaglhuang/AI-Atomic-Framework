import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

type ProtectedOverrideRow = {
  readonly eventId?: string; readonly recordedAt?: string; readonly actorId?: string | null; readonly taskId?: string | null;
  readonly surface?: string; readonly command?: string | null; readonly permission?: string | null; readonly leaseId?: string | null;
  readonly reason?: string | null; readonly parentEventId?: string | null;
  readonly outcome?: string; readonly failureCode?: string | null; readonly touchedFiles?: readonly string[]; readonly emergencyUsePath?: string | null;
};

type WorktreeCommitEvidence = { readonly sha: string; readonly subject: string; readonly committedAt: string; readonly changedFiles: readonly string[] };

export function writeJsonReport(outputPath: string, value: unknown): void {
  const normalized = outputPath.replace(/\\/g, '/');
  const parent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
  if (parent) mkdirSync(parent, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJsonRows(root: string): ProtectedOverrideRow[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).flatMap((entry) => {
    try { return [JSON.parse(readFileSync(join(root, entry.name), 'utf8')) as ProtectedOverrideRow]; } catch { return []; }
  });
}

function receiptAvailability(receiptPath: string | null | undefined): 'available' | 'missing' | 'not-recorded' {
  const normalized = String(receiptPath ?? '').trim();
  if (!normalized) return 'not-recorded';
  return existsSync(normalized) ? 'available' : 'missing';
}

function readWorktrees(cwd: string, override: string | null): Array<{ path: string; head: string | null; detached: boolean }> {
  const text = override ? readFileSync(override, 'utf8') : execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  return text.trim().split(/\r?\n\r?\n/).flatMap((block) => {
    const fields = new Map(block.split(/\r?\n/).map((line) => { const space = line.indexOf(' '); return [space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1)]; }));
    const path = fields.get('worktree');
    return path ? [{ path: path.replace(/\\/g, '/'), head: fields.get('HEAD') || null, detached: fields.has('detached') }] : [];
  });
}

function inspectCommit(cwd: string, head: string | null): WorktreeCommitEvidence | null {
  if (!head) return null;
  try {
    const summary = execFileSync('git', ['show', '-s', '--format=%H%x1f%s%x1f%aI', head], { cwd, encoding: 'utf8' }).trim().split('\x1f');
    const changedFiles = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', head], { cwd, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    return summary.length === 3 ? { sha: summary[0], subject: summary[1], committedAt: summary[2], changedFiles } : null;
  } catch { return null; }
}

export function buildGovernanceBypassAudit(input: { cwd: string; protectedOverrideRoot: string; worktreePorcelain: string | null }) {
  const protectedOverrideRoot = isAbsolute(input.protectedOverrideRoot) ? input.protectedOverrideRoot : join(input.cwd, input.protectedOverrideRoot);
  const bypassRows = readJsonRows(protectedOverrideRoot).map((row) => {
    const receiptLinked = Boolean(row.leaseId && row.permission && row.emergencyUsePath);
    const disposition = !receiptLinked ? 'blocker-missing-approval-or-receipt' : row.outcome === 'failed' ? 'blocker-authorized-operation-failed' : row.outcome === 'succeeded' ? 'review-authorized-exception' : 'pending-authorized-operation';
    const receiptPath = row.emergencyUsePath ?? null;
    return {
      eventId: row.eventId ?? null,
      recordedAt: row.recordedAt ?? null,
      actorId: row.actorId ?? null,
      taskId: row.taskId ?? null,
      surface: row.surface ?? null,
      command: row.command ?? null,
      reason: row.reason ?? null,
      parentEventId: row.parentEventId ?? null,
      touchedFiles: [...(row.touchedFiles ?? [])],
      // Historical override events predate head capture.  Preserve the absence
      // as a source fact; never infer commit boundaries from a later HEAD.
      headBefore: null,
      headAfter: null,
      headEvidenceAvailability: 'unavailable-no-event-field',
      approval: receiptLinked ? 'receipt-linked' : 'NONE',
      receiptPath,
      receiptAvailability: receiptAvailability(receiptPath),
      outcome: row.outcome ?? 'unknown',
      failureCode: row.failureCode ?? null,
      disposition,
      normalRouteAvailability: row.command?.startsWith('node atm.mjs') ? 'governed-route-known' : 'unknown'
    };
  });
  const rescueRows = readWorktrees(input.cwd, input.worktreePorcelain).filter((worktree) => /(?:^|\/)ATM-rescue-[^/]+$/i.test(worktree.path)).map((worktree) => {
    const commit = inspectCommit(input.cwd, worktree.head);
    const classification = !worktree.detached ? 'non-detached-rescue-review-required' : commit?.changedFiles.length ? 'detached-rescue-contribution-write-violation' : 'detached-rescue-write-history-unresolved';
    return { ...worktree, commit, classification, charter: ['INV-ATM-008', 'INV-ATM-010'], disposition: 'retain-evidence-hold-no-cleanup' };
  });
  const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
  return {
    bypassDisposition: { schemaId: 'atm.governanceBypassDisposition.v1', generatedAt: new Date().toISOString(), source: { protectedOverrideRoot: input.protectedOverrideRoot, rowCount: bypassRows.length }, rows: bypassRows, summary: { blockers: bypassRows.filter((row) => row.disposition.startsWith('blocker-')).length, approvedExceptions: bypassRows.filter((row) => row.disposition === 'review-authorized-exception').length }, digest: digest(bypassRows) },
    rescueWorktreeAudit: { schemaId: 'atm.rescueWorktreeAudit.v1', generatedAt: new Date().toISOString(), source: { worktreeRegistry: 'git worktree list --porcelain' }, rows: rescueRows, summary: { count: rescueRows.length, detachedCount: rescueRows.filter((row) => row.detached).length, violationCount: rescueRows.filter((row) => row.classification === 'detached-rescue-contribution-write-violation').length, unresolvedHistoryCount: rescueRows.filter((row) => row.classification === 'detached-rescue-write-history-unresolved').length, cleanupDisposition: 'TASK-TMP-0008-owner-approval-required' }, digest: digest(rescueRows) }
  };
}
