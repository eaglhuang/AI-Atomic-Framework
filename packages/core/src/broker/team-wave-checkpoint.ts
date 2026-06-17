// TASK-MAO-0030: wave checkpoint partial-completion semantics. Combines worker
// reports (TASK-MAO-0028) and the wave evidence slice (TASK-MAO-0029) to decide,
// per member, a final wave execution state and whether the coordinator may
// prepare close input for it. Only `done` members are close-ready. Checkpoint
// never closes a card — it only produces the input the existing close path
// (batch checkpoint / taskflow close) consumes (spec §7).
import type { WaveExecutionState } from './team-wave-envelope.ts';
import { effectiveExecutionState, type TeamWorkerReport } from './team-worker-report.ts';
import type { WaveEvidenceResult } from './team-wave-evidence.ts';

export interface WaveCheckpointMember {
  readonly taskId: string;
  readonly report: TeamWorkerReport | null;
}

export interface WaveCheckpointInput {
  readonly members: readonly WaveCheckpointMember[];
  readonly evidence: WaveEvidenceResult;
}

export interface MemberCheckpoint {
  readonly taskId: string;
  readonly state: WaveExecutionState;
  readonly closeReady: boolean;
  readonly reason: string;
}

export interface WaveCheckpointResult {
  readonly schemaId: 'atm.teamWaveCheckpoint.v1';
  readonly members: readonly MemberCheckpoint[];
  /** Task ids whose close input the coordinator may prepare. */
  readonly closeReadyTaskIds: readonly string[];
  /** True when the whole wave's evidence sliced cleanly. */
  readonly evidenceClean: boolean;
}

/**
 * Resolve each member's checkpoint state. The wave evidence gate is authoritative:
 * if the slice is `needs-review`, NO member is close-ready regardless of its own
 * report (spec §7 — ambiguous attribution blocks the whole wave). Otherwise a
 * member is close-ready only when its reconciled worker state is `done`.
 */
export function checkpointWave(input: WaveCheckpointInput): WaveCheckpointResult {
  const evidenceClean = input.evidence.state === 'done';
  const attributed = new Map(input.evidence.slices.map((s) => [s.taskId, s.attributedFiles]));

  const members: MemberCheckpoint[] = input.members.map((member) => {
    if (!member.report) {
      return {
        taskId: member.taskId,
        state: 'not-started',
        closeReady: false,
        reason: 'no worker report'
      };
    }

    const reported = effectiveExecutionState(member.report);
    if (!evidenceClean) {
      return {
        taskId: member.taskId,
        state: 'needs-review',
        closeReady: false,
        reason: 'wave evidence did not slice cleanly; whole wave is needs-review'
      };
    }

    const hasFiles = (attributed.get(member.taskId) ?? []).length > 0;
    if (reported === 'done' && !hasFiles) {
      return {
        taskId: member.taskId,
        state: 'needs-review',
        closeReady: false,
        reason: 'reported done but no files attributed in the wave slice'
      };
    }

    const closeReady = reported === 'done';
    return {
      taskId: member.taskId,
      state: reported,
      closeReady,
      reason: closeReady ? 'done with clean attributed evidence' : `member state is ${reported}`
    };
  });

  return {
    schemaId: 'atm.teamWaveCheckpoint.v1',
    members,
    closeReadyTaskIds: members.filter((m) => m.closeReady).map((m) => m.taskId),
    evidenceClean
  };
}
