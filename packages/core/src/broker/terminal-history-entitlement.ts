import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * ATM-GOV-0369 amendment 1 — who may write a terminal task's history.
 *
 * A closed task keeps generating records: bundle manifests, reconciliation
 * files, receipts. Someone has to be able to commit them. The rule that used to
 * govern this surface derived ownership from the task id embedded in the file
 * name, so the answer was "nobody, forever".
 *
 * The replacement is a governed grant rather than a resemblance. A writer is
 * entitled to a terminal task's history path when its *own* live claim was
 * admitted for that path and declares the card it is answering for. Nothing
 * about the owner's identity — its id, its file names, the shape of the
 * writer's work-item id — participates in the decision.
 */

export type TerminalHistoryOwnershipState = 'live' | 'terminal-entitled' | 'terminal-unentitled';

export interface ReconciliationEntitlementInput {
  /** The writer's own work item id: a task id, or a framework temporary claim. */
  readonly writerWorkItemId: string | null;
  readonly candidateFile: string;
  /** True when a live successor card backs the writer's declared linkage. */
  readonly isLiveTask: (taskId: string) => boolean;
}

interface WriterClaim {
  readonly files: readonly string[];
  readonly linkedTaskId: string | null;
  readonly live: boolean;
}

/**
 * A scope entry confers entitlement only if it names a bounded location. A
 * blanket pattern is an artifact of how a claim was written, not evidence that
 * anyone considered this path — honouring it would hand every framework claim
 * authority over every closed task at once.
 */
function isBoundedScopeEntry(entry: string): boolean {
  const normalized = entry.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!normalized) return false;
  const wildcardIndex = normalized.search(/[*?]/);
  if (wildcardIndex === -1) return true;
  const prefix = normalized.slice(0, wildcardIndex);
  // Require the fixed part to reach past a top-level directory, so `.atm/**`
  // and `**` are rejected while `.atm/history/evidence/<task>.*` is accepted.
  return prefix.split('/').filter(Boolean).length >= 3;
}

function scopeEntryMatches(candidateFile: string, entry: string): boolean {
  const file = candidateFile.replace(/\\/g, '/').toLowerCase();
  const pattern = entry.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return file.startsWith(`${prefix}/`) && !file.slice(prefix.length + 1).includes('/');
  }
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return file.startsWith(`${prefix}.`) && !file.slice(prefix.length + 1).includes('/');
  }
  return file === pattern;
}

function readWriterClaim(cwd: string, writerWorkItemId: string, now: number): WriterClaim | null {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${writerWorkItemId}.lock.json`);
  if (!existsSync(lockPath)) return null;
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const released = lock.released === true || lock.status === 'released';
    const heartbeatAt = typeof lock.heartbeatAt === 'string' ? Date.parse(lock.heartbeatAt) : Number.NaN;
    const ttlSeconds = typeof lock.ttlSeconds === 'number' && Number.isFinite(lock.ttlSeconds) ? lock.ttlSeconds : null;
    const fresh = Number.isFinite(heartbeatAt) && ttlSeconds !== null && now - heartbeatAt <= ttlSeconds * 1000;
    const linked = typeof lock.linkedTaskId === 'string' && lock.linkedTaskId.trim() ? lock.linkedTaskId.trim() : null;
    return {
      files: Array.isArray(lock.files) ? lock.files.filter((entry): entry is string => typeof entry === 'string') : [],
      linkedTaskId: linked,
      live: !released && fresh
    };
  } catch {
    return null;
  }
}

/**
 * Resolve whether a writer may reconcile one path belonging to a terminal task.
 *
 * Fail-closed in every direction: an unreadable claim, a dead claim, an
 * unbounded scope, a missing linkage, or a linkage to a card that is itself
 * terminal all leave the path protected.
 */
export function hasReconciliationEntitlement(
  cwd: string,
  input: ReconciliationEntitlementInput,
  now = Date.now()
): boolean {
  const writerWorkItemId = input.writerWorkItemId?.trim();
  if (!writerWorkItemId) return false;
  const claim = readWriterClaim(cwd, writerWorkItemId, now);
  if (!claim || !claim.live) return false;
  const admitted = claim.files.some(
    (entry) => isBoundedScopeEntry(entry) && scopeEntryMatches(input.candidateFile, entry)
  );
  if (!admitted) return false;
  // The linkage is what makes the write answerable: a reconciliation is
  // performed on behalf of a card that is still open to review it.
  return Boolean(claim.linkedTaskId && input.isLiveTask(claim.linkedTaskId));
}
