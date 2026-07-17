import { resolveActorWorkSession } from '../actor-session.ts';
import { message } from '../shared.ts';

export function buildClaimedMessage(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly actorSource: string;
  readonly actorResolution: unknown;
  readonly recommendedChannel: string;
  readonly claimIntent: string;
  readonly ignoredUntrackedFiles: readonly string[];
}) {
  return message('info', 'ATM_NEXT_CLAIMED', 'Claimed the next imported work item.', {
    taskId: input.taskId,
    actorId: input.actorId,
    actorSource: input.actorSource,
    actorResolution: input.actorResolution,
    recommendedChannel: input.recommendedChannel,
    claimIntent: input.claimIntent,
    batchCheckpointCommand: input.recommendedChannel === 'batch'
      ? 'node atm.mjs batch checkpoint --actor <id> --json'
      : null,
    blockedPattern: input.recommendedChannel === 'batch' ? 'manual tasks claim/close loop' : null,
    ignoredUntrackedFiles: input.ignoredUntrackedFiles,
    ignoredUntrackedNote: input.ignoredUntrackedFiles.length > 0
      ? 'These files are NOT blocking the claim. If any of them is actually a deliverable for this task, run `node atm.mjs tasks scope --add <paths>` to widen the scope and then `git add` them.'
      : null
  });
}

export function resolveCurrentLaneSessionIdForFreshReservation(cwd: string, actorId: string): string | null {
  return normalizeOptionalLaneSessionId(process.env.ATM_LANE_SESSION_ID)
    ?? normalizeOptionalLaneSessionId(resolveActorWorkSession(cwd, { actorId })?.guidanceSessionId);
}

export function normalizeClaimLaneSessionEnvelope(value: Record<string, unknown> | null): {
  readonly laneSessionId: string;
  readonly status: string;
  readonly source: string;
  readonly exportHint: string;
} | null {
  if (!value) return null;
  const laneSessionId = typeof value.laneSessionId === 'string' ? value.laneSessionId.trim() : '';
  const status = typeof value.status === 'string' ? value.status.trim() : '';
  const source = typeof value.source === 'string' ? value.source.trim() : '';
  const exportHint = typeof value.exportHint === 'string' ? value.exportHint.trim() : '';
  if (!laneSessionId || !status || !source || !exportHint) return null;
  return { laneSessionId, status, source, exportHint };
}

function normalizeOptionalLaneSessionId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
