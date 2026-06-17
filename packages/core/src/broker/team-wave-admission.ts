// TASK-MAO-0026: Team Agents Wave Mode broker admission. Given a proposed wave
// of cards (plus optional active write intents), decide which members may be
// admitted to run in parallel. Layers the broker logical conflict matrix
// (TASK-MAO-0005/0006) on top of the metadata-level wave planner rules
// (TASK-MAO-0024). Fails closed on every category it cannot prove safe.
import {
  pairBlockReasons,
  type WaveCandidateCard,
  type WaveBlockReason
} from './team-wave-planner.ts';
import { evaluateConflictMatrix } from './conflict-matrix.ts';
import type { ActiveWriteIntent, WriteIntent } from './types.ts';

export type WaveAdmissionCategory =
  | 'dependency'
  | 'scope-overlap'
  | 'cid-conflict'
  | 'generated-artifact'
  | 'closure-authority'
  | 'target-repo'
  | 'missing-worker-report'
  | 'missing-validator';

export interface WaveAdmissionMemberInput {
  readonly card: WaveCandidateCard;
  /** The card's intended write set, if a patch envelope / intent was captured. */
  readonly writeIntent?: WriteIntent | null;
  /** Whether a worker report exists for this in-flight card. */
  readonly hasWorkerReport?: boolean;
}

export interface WaveAdmissionInput {
  readonly members: readonly WaveAdmissionMemberInput[];
  readonly closedTaskIds?: readonly string[];
  readonly appendSafePaths?: readonly string[];
  /** When true, an in-flight member without a worker report is rejected. */
  readonly requireWorkerReports?: boolean;
}

export interface WaveAdmissionRejection {
  readonly taskId: string;
  readonly categories: readonly WaveAdmissionCategory[];
  readonly detail: string;
}

export interface WaveAdmissionDecision {
  readonly schemaId: 'atm.teamWaveAdmission.v1';
  readonly admitted: readonly string[];
  readonly rejected: readonly WaveAdmissionRejection[];
  /** True only if at least one member was admitted and none failed closed unexpectedly. */
  readonly ok: boolean;
}

const BLOCK_REASON_TO_CATEGORY: Record<WaveBlockReason, WaveAdmissionCategory> = {
  'depends-on-open-wave-member': 'dependency',
  'scope-overlap-unknown-range': 'scope-overlap',
  'same-atom-write-write': 'cid-conflict',
  'closure-authority-mismatch': 'closure-authority',
  'target-repo-mismatch': 'target-repo',
  'generated-artifact-contention': 'generated-artifact',
  'missing-validator': 'missing-validator'
};

/**
 * Admit a proposed wave. A member is admitted only when:
 *  - all its dependencies are closed (outside the wave),
 *  - it declares at least one validator,
 *  - it has no metadata-level conflict with any already-admitted member,
 *  - its write intent does not produce a freeze/takeover verdict against the
 *    admitted members' intents (CID logical conflict),
 *  - a worker report exists when required.
 * Evaluation is deterministic by task id; the first member of a conflicting pair
 * is admitted and the later one is rejected (fail closed).
 */
export function admitWave(input: WaveAdmissionInput): WaveAdmissionDecision {
  const appendSafe = new Set((input.appendSafePaths ?? []).map((p) => p.trim()));
  const closed = new Set((input.closedTaskIds ?? []).map((t) => t.trim()));
  const ordered = [...input.members].sort((a, b) => a.card.taskId.localeCompare(b.card.taskId));

  const admittedCards: WaveCandidateCard[] = [];
  const admittedIntents: ActiveWriteIntent[] = [];
  const admitted: string[] = [];
  const rejected: WaveAdmissionRejection[] = [];

  for (const member of ordered) {
    const card = member.card;
    const categories = new Set<WaveAdmissionCategory>();

    // Dependency rule (spec §5.1).
    const depReady = card.dependencies.every((d) => closed.has(d.trim()));
    if (!depReady) categories.add('dependency');

    // Validators (spec §5.4).
    if ((card.validators ?? []).filter((v) => v.trim().length > 0).length === 0) {
      categories.add('missing-validator');
    }

    // Worker report (spec §6).
    if (input.requireWorkerReports && member.hasWorkerReport === false) {
      categories.add('missing-worker-report');
    }

    // Metadata-level pairwise rules against already-admitted members.
    for (const prior of admittedCards) {
      for (const reason of pairBlockReasons(prior, card, appendSafe)) {
        categories.add(BLOCK_REASON_TO_CATEGORY[reason]);
      }
    }

    // CID logical conflict via the broker matrix (spec §5.3).
    if (member.writeIntent && admittedIntents.length > 0) {
      const verdict = evaluateConflictMatrix(member.writeIntent, admittedIntents).arbitrationVerdict;
      if (verdict === 'freeze' || verdict === 'takeover') {
        categories.add('cid-conflict');
      }
    }

    if (categories.size > 0) {
      rejected.push({
        taskId: card.taskId,
        categories: [...categories],
        detail: `deferred to a later wave: ${[...categories].join(', ')}`
      });
      continue;
    }

    admittedCards.push(card);
    admitted.push(card.taskId);
    if (member.writeIntent) {
      admittedIntents.push(toActiveIntent(member.writeIntent));
    }
  }

  return {
    schemaId: 'atm.teamWaveAdmission.v1',
    admitted,
    rejected,
    ok: admitted.length > 0
  };
}

function toActiveIntent(intent: WriteIntent): ActiveWriteIntent {
  const now = new Date().toISOString();
  return {
    intentId: `wave-intent-${intent.taskId}`,
    taskId: intent.taskId,
    teamRunId: null,
    actorId: intent.actorId,
    baseCommit: intent.baseCommit,
    resourceKeys: {
      files: intent.targetFiles,
      atomIds: intent.atomRefs.map((ref) => ref.atomId),
      atomCids: intent.atomRefs.map((ref) => ref.atomCid),
      generators: intent.sharedSurfaces.generators,
      projections: intent.sharedSurfaces.projections,
      registries: intent.sharedSurfaces.registries,
      validators: intent.sharedSurfaces.validators,
      artifacts: intent.sharedSurfaces.artifacts
    },
    leaseEpoch: Date.now(),
    leaseSeconds: 1800,
    leaseMaxSeconds: 3600,
    heartbeatAt: now,
    lane: 'direct-brokered'
  };
}
