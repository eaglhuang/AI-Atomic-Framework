import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectReferencedLaneSession } from './resolve.ts';

export type LaneResidueOwnerState = 'active' | 'released' | 'expired' | 'unknown';

export interface LaneSessionResidueAnalysis {
  readonly finding: {
    readonly path: string;
    readonly verdict: 'auto-clean-safe' | 'manual-review';
    readonly reason: string;
    readonly ownerTaskId: string | null;
    readonly cleanupAction: 'remove' | null;
  };
  readonly owner: {
    readonly state: LaneResidueOwnerState;
    readonly actorId: string | null;
  };
}

export function analyzeLaneSessionResidue(
  cwd: string,
  filePath: string,
  readTaskStatus: (taskId: string | null) => string | null
): LaneSessionResidueAnalysis | null {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!/^\.atm\/runtime\/lane-sessions\/[^/]+\.json$/i.test(normalizedPath)) return null;
  const laneId = path.basename(normalizedPath, '.json');
  const record = readLaneSessionRecord(cwd, normalizedPath, laneId);
  const inspection = record ? inspectReferencedLaneSession({ cwd, laneSessionId: laneId }) : null;
  const session = inspection?.session ?? null;
  if (!session || !inspection) {
    return {
      finding: {
        path: normalizedPath,
        verdict: 'manual-review',
        reason: 'lane-session runtime file is malformed or its schema/id does not match the path; preserve it for manual review.',
        ownerTaskId: record?.taskId ?? null,
        cleanupAction: null
      },
      owner: { state: 'unknown', actorId: null }
    };
  }
  const ownerTaskId = session.taskId?.toUpperCase() ?? null;
  const taskStatus = ownerTaskId ? readTaskStatus(ownerTaskId) : null;
  const activeTask = Boolean(taskStatus && !['abandoned', 'cancelled', 'canceled', 'closed', 'done', 'released'].includes(taskStatus.toLowerCase()));
  const ended = inspection.availability === 'released' || inspection.availability === 'expired';
  const safeToRemove = ended && !activeTask;
  const reason = safeToRemove
    ? 'Lane session is released or TTL-expired without an active task owner; its runtime authority is disposable.'
    : activeTask
      ? `Lane session belongs to non-terminal task ${ownerTaskId}; preserve it for owner reconciliation.`
      : 'Lane session is still within its active lifetime; preserve it.';
  const ownerState: LaneResidueOwnerState = inspection.availability === 'available'
    ? 'active'
    : inspection.availability === 'released'
      ? 'released'
      : inspection.availability === 'expired'
        ? 'expired'
        : 'unknown';
  return {
    finding: {
      path: normalizedPath,
      verdict: safeToRemove ? 'auto-clean-safe' : 'manual-review',
      reason,
      ownerTaskId,
      cleanupAction: safeToRemove ? 'remove' : null
    },
    owner: { state: ownerState, actorId: session.actorId }
  };
}

function readLaneSessionRecord(cwd: string, filePath: string, laneId: string): { taskId: string | null } | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(cwd, filePath), 'utf8')) as Record<string, unknown>;
    if (raw.schemaId !== 'atm.laneSession.v1'
      || raw.laneId !== laneId
      || typeof raw.actorId !== 'string'
      || !raw.actorId.trim()
      || typeof raw.status !== 'string'
      || !['active', 'handoff', 'adopted', 'released', 'expired'].includes(raw.status)
      || typeof raw.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(raw.expiresAt))) return null;
    return { taskId: typeof raw.taskId === 'string' && raw.taskId.trim() ? raw.taskId.trim().toUpperCase() : null };
  } catch {
    return null;
  }
}
