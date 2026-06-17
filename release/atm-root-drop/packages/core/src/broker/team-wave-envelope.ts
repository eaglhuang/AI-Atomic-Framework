// TASK-MAO-0025: Team Wave Envelope. Wraps a planned wave (TASK-MAO-0024) plus
// one per-worker patch envelope (TASK-MAO-0008) reference per member, into a
// single record the coordinator uses for admission, evidence slicing, and
// checkpoint. Conforms to schemas/team-wave-envelope.schema.json.

export type WaveExecutionState =
  | 'done'
  | 'partial'
  | 'blocked'
  | 'not-started'
  | 'needs-review';

export interface TeamWaveMemberEnvelope {
  readonly taskId: string;
  readonly workerActorId: string | null;
  readonly scopePaths: readonly string[];
  readonly deliverables: readonly string[];
  /** Reference to the worker's patch envelope (atm.patchEnvelope.v1) id, if captured. */
  readonly patchEnvelopeId: string | null;
  readonly executionState?: WaveExecutionState;
}

export interface TeamWaveEnvelope {
  readonly schemaId: 'atm.teamWaveEnvelope.v1';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly waveId: string;
  readonly coordinatorActorId: string;
  readonly targetRepo: string | null;
  readonly closureAuthority: string | null;
  readonly members: readonly TeamWaveMemberEnvelope[];
  readonly metadata: {
    readonly plannedAt: string;
    readonly waveIndex: number;
    readonly appendSafePaths?: readonly string[];
    readonly notes?: string | null;
  };
}

export function createTeamWaveEnvelope(input: {
  readonly waveId?: string;
  readonly coordinatorActorId: string;
  readonly targetRepo: string | null;
  readonly closureAuthority: string | null;
  readonly waveIndex: number;
  readonly members: readonly TeamWaveMemberEnvelope[];
  readonly appendSafePaths?: readonly string[];
  readonly plannedAt?: string;
  readonly notes?: string | null;
}): TeamWaveEnvelope {
  return {
    schemaId: 'atm.teamWaveEnvelope.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'Team wave envelope baseline record.' },
    waveId: input.waveId ?? `team-wave-${input.waveIndex}-${Date.now()}`,
    coordinatorActorId: input.coordinatorActorId,
    targetRepo: input.targetRepo,
    closureAuthority: input.closureAuthority,
    members: input.members,
    metadata: {
      plannedAt: input.plannedAt ?? new Date().toISOString(),
      waveIndex: input.waveIndex,
      appendSafePaths: input.appendSafePaths ?? [],
      notes: input.notes ?? null
    }
  };
}

export interface TeamWaveEnvelopeValidation {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * Structural validation beyond the JSON schema: enforces the cross-field
 * invariants from the spec — single target repo, single closure authority, and
 * disjoint declared deliverables across members (spec §5 rules 5, 6, 2/7).
 */
export function validateTeamWaveEnvelope(envelope: TeamWaveEnvelope): TeamWaveEnvelopeValidation {
  if (envelope.schemaId !== 'atm.teamWaveEnvelope.v1') {
    return { ok: false, reason: 'schemaId must be atm.teamWaveEnvelope.v1' };
  }
  if (envelope.members.length === 0) {
    return { ok: false, reason: 'wave envelope must have at least one member' };
  }
  if (!envelope.coordinatorActorId.trim()) {
    return { ok: false, reason: 'coordinatorActorId is required' };
  }

  const seen = new Map<string, string>();
  for (const member of envelope.members) {
    if (!member.taskId.trim()) {
      return { ok: false, reason: 'every member requires a taskId' };
    }
    for (const deliverable of member.deliverables) {
      const prior = seen.get(deliverable);
      if (prior && prior !== member.taskId) {
        return {
          ok: false,
          reason: `deliverable ${deliverable} is claimed by both ${prior} and ${member.taskId}`
        };
      }
      seen.set(deliverable, member.taskId);
    }
  }

  return { ok: true, reason: 'team wave envelope is valid' };
}

/** Members whose execution state allows close-input preparation (spec §7). */
export function closeReadyMembers(envelope: TeamWaveEnvelope): readonly TeamWaveMemberEnvelope[] {
  return envelope.members.filter((m) => m.executionState === 'done');
}
