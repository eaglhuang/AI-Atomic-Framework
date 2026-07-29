import { createHash } from 'node:crypto';
export function buildTicketObservation(input) {
    const withoutDigest = {
        schemaId: 'atm.replayDashboardTicketObservation.v1',
        participantId: input.participantId,
        taskId: input.taskId,
        actorId: input.actorId,
        ticketId: normalizeOptional(input.ticketId),
        generation: input.ticketGeneration == null ? null : String(input.ticketGeneration),
        state: normalizeOptional(input.state) ?? 'unknown',
        queuePosition: typeof input.queuePosition === 'number' && Number.isFinite(input.queuePosition) ? input.queuePosition : null,
        waitedMs: Math.max(0, typeof input.waitedMs === 'number' && Number.isFinite(input.waitedMs) ? input.waitedMs : 0),
        releaseCondition: normalizeOptional(input.releaseCondition) ?? 'not-observed',
        eventDigests: uniqueSorted(input.eventDigests ?? [])
    };
    return { ...withoutDigest, digest: digestJson(withoutDigest) };
}
export function summarizeTicketObservations(inputs) {
    const observations = inputs.map(buildTicketObservation).sort((left, right) => left.participantId.localeCompare(right.participantId));
    const withoutDigest = {
        schemaId: 'atm.replayDashboardTicketObservationSummary.v1',
        observationCount: observations.length,
        participantCount: new Set(observations.map((entry) => entry.participantId)).size,
        zeroWaitSafeComposeEligible: observations.length >= 2 && observations.every((entry) => entry.waitedMs === 0 && entry.state === 'execute-now'),
        missingReleaseConditionCount: observations.filter((entry) => entry.releaseCondition === 'not-observed').length,
        observations
    };
    return { ...withoutDigest, digest: digestJson(withoutDigest) };
}
function normalizeOptional(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function uniqueSorted(values) {
    return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
