import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listActorWorkSessions, upsertActorWorkSession } from '../actor-session.ts';
import { parseClaimRecord, type TaskClaimRecordWithLane } from '../tasks/task-ledger-readers.ts';
import type { LaneSessionDocument } from './store.ts';

export interface LaneAdoptRebindResult {
  readonly reboundSessionIds: readonly string[];
  readonly reboundTaskIds: readonly string[];
  readonly preservedLeaseIds: readonly string[];
}

export function rebindLifecycleAfterLaneAdopt(input: {
  readonly cwd: string;
  readonly laneId: string;
  readonly actorId: string;
  readonly session: LaneSessionDocument;
  readonly timestamp?: string;
}): LaneAdoptRebindResult {
  const cwd = path.resolve(input.cwd);
  const nowIso = input.timestamp ?? new Date().toISOString();
  const reboundSessionIds: string[] = [];
  const reboundTaskIds: string[] = [];
  const preservedLeaseIds: string[] = [];

  for (const workSession of listActorWorkSessions(cwd)) {
    if (workSession.status !== 'active') continue;
    if (workSession.guidanceSessionId !== input.laneId) continue;
    upsertActorWorkSession({
      cwd,
      sessionId: workSession.sessionId,
      actorId: input.actorId,
      taskId: workSession.taskId,
      claimLeaseId: workSession.claimLeaseId,
      status: 'active',
      timestamp: nowIso,
      taskPath: workSession.taskPath,
      sourcePrompt: workSession.sourcePrompt,
      batchId: workSession.batchId,
      guidanceSessionId: input.laneId,
      editor: workSession.editor,
      gitName: workSession.gitName,
      gitEmail: workSession.gitEmail,
      reason: workSession.reason ?? `lane adopt rebind to ${input.laneId}`
    });
    reboundSessionIds.push(workSession.sessionId);
    if (workSession.claimLeaseId) preservedLeaseIds.push(workSession.claimLeaseId);
  }

  const taskIds = new Set<string>();
  if (input.session.taskId) taskIds.add(input.session.taskId);
  for (const sessionId of reboundSessionIds) {
    const matched = listActorWorkSessions(cwd).find((entry) => entry.sessionId === sessionId);
    if (matched?.taskId) taskIds.add(matched.taskId);
  }
  for (const taskId of listTaskIdsWithLaneClaim(cwd, input.laneId)) {
    taskIds.add(taskId);
  }

  for (const taskId of taskIds) {
    const rebound = rebindTaskClaimLane({
      cwd,
      taskId,
      laneId: input.laneId,
      actorId: input.actorId,
      laneStatus: input.session.status
    });
    if (!rebound) continue;
    reboundTaskIds.push(taskId);
    preservedLeaseIds.push(rebound.leaseId);
  }

  return {
    reboundSessionIds: [...new Set(reboundSessionIds)].sort(),
    reboundTaskIds: [...new Set(reboundTaskIds)].sort(),
    preservedLeaseIds: [...new Set(preservedLeaseIds)].sort()
  };
}

function listTaskIdsWithLaneClaim(cwd: string, laneId: string): readonly string[] {
  const root = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(root)) return [];
  const matches: string[] = [];
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith('.json')) continue;
    const taskId = entry.replace(/\.json$/, '');
    const absolutePath = path.join(root, entry);
    try {
      const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
      const claim = parseClaimRecord(parsed.claim);
      if (claim?.state === 'active' && claim.laneSession?.laneSessionId === laneId) {
        matches.push(taskId);
      }
    } catch {
      // Ignore malformed task documents during adopt rebind.
    }
  }
  return matches;
}

function rebindTaskClaimLane(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly laneId: string;
  readonly actorId: string;
  readonly laneStatus: string;
}): { readonly leaseId: string } | null {
  const absolutePath = path.join(input.cwd, '.atm', 'history', 'tasks', `${input.taskId}.json`);
  if (!existsSync(absolutePath)) return null;
  const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
  const claim = parseClaimRecord(parsed.claim);
  if (!claim || claim.state !== 'active') return null;
  if (claim.laneSession && claim.laneSession.laneSessionId !== input.laneId) return null;

  const nextClaim: TaskClaimRecordWithLane = {
    ...claim,
    actorId: input.actorId,
    laneSession: {
      laneSessionId: input.laneId,
      status: input.laneStatus,
      source: claim.laneSession?.source ?? 'option',
      exportHint: claim.laneSession?.exportHint ?? `export ATM_LANE_SESSION_ID=${JSON.stringify(input.laneId)}`
    }
  };
  parsed.claim = nextClaim;
  writeFileSync(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return { leaseId: claim.leaseId };
}
