// TASK-MAO-0025: Team Wave Envelope. Wraps a planned wave (TASK-MAO-0024) plus
// one per-worker patch envelope (TASK-MAO-0008) reference per member, into a
// single record the coordinator uses for admission, evidence slicing, and
// checkpoint. Conforms to schemas/team-wave-envelope.schema.json.
export function createTeamWaveEnvelope(input) {
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
/**
 * Structural validation beyond the JSON schema: enforces the cross-field
 * invariants from the spec — single target repo, single closure authority, and
 * disjoint declared deliverables across members (spec §5 rules 5, 6, 2/7).
 */
export function validateTeamWaveEnvelope(envelope) {
    if (envelope.schemaId !== 'atm.teamWaveEnvelope.v1') {
        return { ok: false, reason: 'schemaId must be atm.teamWaveEnvelope.v1' };
    }
    if (envelope.members.length === 0) {
        return { ok: false, reason: 'wave envelope must have at least one member' };
    }
    if (!envelope.coordinatorActorId.trim()) {
        return { ok: false, reason: 'coordinatorActorId is required' };
    }
    const seen = new Map();
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
export function closeReadyMembers(envelope) {
    return envelope.members.filter((m) => m.executionState === 'done');
}
