import { createHash } from 'node:crypto';

/**
 * Branch commit-window coordinator.
 *
 * `coordinateBranchCommit` is the ONLY branch commit-window policy. Governed
 * commit, taskflow close, and batch checkpoint adapters all consume this one
 * decision; no caller re-derives stale-lock, candidate, stage, or queue
 * ownership rules. It is a pure function: the caller supplies a snapshot of the
 * current fenced window state and executes the returned action through ports.
 *
 * It fixes the pre-commit-timeout orphan-lock incident
 * (ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY): a dead owner before commit is recoverable
 * even when HEAD did not move. Reclaim requires expiry, dead/invalid owner
 * proof, an unchanged fenced generation, and the executing lane capability — it
 * never relies on manual deletion under `.atm/runtime`.
 */

export type BranchCommitAction = 'acquire' | 'wait' | 'reclaim' | 'release';

export interface BranchCommitWindowOwner {
  readonly laneSessionId: string;
  readonly actorId: string | null;
  /** Fenced generation the owner acquired the window at. */
  readonly generation: number;
  /** Lease expiry (ISO-8601). */
  readonly expiresAt: string;
  /** HEAD sha observed when the owner acquired the window. */
  readonly headShaAtAcquire: string | null;
  /** Proven-dead owner (process gone / heartbeat lost), if known. */
  readonly liveness: 'live' | 'dead' | 'unknown';
}

export interface BranchCommitSnapshot {
  readonly branch: string;
  /** Current fenced window owner, or null when the window is free. */
  readonly owner: BranchCommitWindowOwner | null;
  /** Live fenced generation for the branch window. */
  readonly currentGeneration: number;
  /** HEAD sha right now. */
  readonly headSha: string | null;
}

export interface BranchCommitRequest {
  readonly branch: string;
  readonly taskId: string;
  /** Executing lane capability (authority, not the actor string). */
  readonly executingLaneSessionId: string | null;
  readonly actorId?: string | null;
  /** Exact files the caller intends to commit. */
  readonly candidateFiles: readonly string[];
  /** 'commit' | 'close' | 'batch-checkpoint' — the adapter kind (attribution). */
  readonly adapter: 'commit' | 'close' | 'batch-checkpoint';
  readonly now?: string;
  /** Set when the caller has finished and is releasing the window. */
  readonly releasing?: boolean;
}

export interface BranchCommitPlan {
  readonly schemaId: 'atm.branchCommitPlan.v1';
  readonly action: BranchCommitAction;
  readonly allowed: boolean;
  readonly branch: string;
  readonly taskId: string;
  /** Fencing token the caller must present when it mutates/releases. */
  readonly fencingToken: string;
  /** Idempotency key: repeated identical requests map to the same window op. */
  readonly idempotencyKey: string;
  /** The exact candidate set, normalized and deduped. */
  readonly candidateSet: readonly string[];
  readonly executingLaneFingerprint: string | null;
  readonly ownerLaneFingerprint: string | null;
  /** Executable recovery when blocked (wait) — never a manual .atm deletion. */
  readonly recoveryCommand: string;
  readonly reason: string;
}

function fingerprint(value: string | null | undefined, kind: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return `${kind}fp:${createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16)}`;
}

function normalizeCandidates(files: readonly string[]): readonly string[] {
  return [...new Set(files.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function isExpired(expiresAt: string, now: string | undefined): boolean {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return true;
  const at = now ? Date.parse(now) : Date.now();
  return Number.isNaN(at) ? true : at >= expiry;
}

/**
 * Decide the branch commit-window action. Fail-closed: when another live owner
 * holds the window the caller waits; reclaim is only offered against a proven
 * dead/expired owner at an unchanged fenced generation.
 */
export function coordinateBranchCommit(
  request: BranchCommitRequest,
  snapshot: BranchCommitSnapshot
): BranchCommitPlan {
  const candidateSet = normalizeCandidates(request.candidateFiles);
  const executingLane = normalize(request.executingLaneSessionId);
  const ownerLane = snapshot.owner ? snapshot.owner.laneSessionId : null;
  // Idempotency binds branch + task + lane + generation + candidate digest, so a
  // retried identical request maps to the same window operation.
  const idempotencyKey = createHash('sha256')
    .update([request.branch, request.taskId, executingLane ?? '', String(snapshot.currentGeneration), candidateSet.join(',')].join('\n'))
    .digest('hex')
    .slice(0, 24);
  // The fencing token binds the generation; a stale-generation holder cannot act.
  const fencingToken = `fence:${snapshot.currentGeneration}:${createHash('sha256').update(`${request.branch}\n${executingLane ?? ''}\n${snapshot.currentGeneration}`).digest('hex').slice(0, 16)}`;

  const base = {
    schemaId: 'atm.branchCommitPlan.v1' as const,
    branch: request.branch,
    taskId: request.taskId,
    fencingToken,
    idempotencyKey,
    candidateSet,
    executingLaneFingerprint: fingerprint(executingLane, 'lane'),
    ownerLaneFingerprint: fingerprint(ownerLane, 'lane')
  };

  const reclaimCommand = `node atm.mjs git commit --actor ${request.actorId ?? '<actor>'} --task ${request.taskId} --lane-session "$ATM_LANE_SESSION_ID" --json`;
  const waitCommand = `node atm.mjs broker status --json  # branch ${request.branch} commit window held; retry when free`;

  // No executing lane capability -> cannot bind authority to an actor string.
  if (!executingLane) {
    return {
      ...base,
      action: 'wait',
      allowed: false,
      recoveryCommand: waitCommand,
      reason: 'No executing lane capability present; branch commit authority cannot bind to an actor string.'
    };
  }

  // Release path: the caller owns the window and is finishing.
  if (request.releasing) {
    const ownsWindow = ownerLane === executingLane && snapshot.owner?.generation === snapshot.currentGeneration;
    return {
      ...base,
      action: 'release',
      allowed: ownsWindow,
      recoveryCommand: reclaimCommand,
      reason: ownsWindow
        ? 'Executing lane owns the current-generation window; release is authorized.'
        : 'Release requested but executing lane does not hold the current-generation window.'
    };
  }

  // Free window -> acquire.
  if (!snapshot.owner) {
    return {
      ...base,
      action: 'acquire',
      allowed: true,
      recoveryCommand: reclaimCommand,
      reason: 'Branch commit window is free; acquire at the current fenced generation.'
    };
  }

  // Executing lane already owns the window at the live generation -> acquire (idempotent re-entry).
  if (ownerLane === executingLane && snapshot.owner.generation === snapshot.currentGeneration) {
    return {
      ...base,
      action: 'acquire',
      allowed: true,
      recoveryCommand: reclaimCommand,
      reason: 'Executing lane already holds the current-generation window; re-entry is idempotent.'
    };
  }

  // A different owner holds the window. Reclaim is allowed ONLY against a proven
  // dead/expired owner at an unchanged fenced generation — even if HEAD did not
  // move (the orphan-lock incident). Otherwise wait.
  const ownerDead = snapshot.owner.liveness === 'dead';
  const ownerExpired = isExpired(snapshot.owner.expiresAt, request.now);
  const generationUnchanged = snapshot.owner.generation === snapshot.currentGeneration;
  if ((ownerDead || ownerExpired) && generationUnchanged) {
    return {
      ...base,
      action: 'reclaim',
      allowed: true,
      recoveryCommand: reclaimCommand,
      reason: ownerDead
        ? 'Prior owner is proven dead at an unchanged fenced generation; reclaim without manual lock deletion (HEAD movement not required).'
        : 'Prior owner lease expired at an unchanged fenced generation; reclaim without manual lock deletion.'
    };
  }

  return {
    ...base,
    action: 'wait',
    allowed: false,
    recoveryCommand: waitCommand,
    reason: snapshot.owner.liveness === 'live'
      ? 'Another live lane holds the branch commit window; wait for release.'
      : 'Branch commit window held by another lane; owner not proven dead/expired at the current generation, so reclaim is refused. Wait or re-probe liveness.'
  };
}

function normalize(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
