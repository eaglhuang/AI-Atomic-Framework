import { createHash } from 'node:crypto';

export interface ReplayDashboardTicketObservationInput {
  readonly participantId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly ticketId?: string | null;
  readonly ticketGeneration?: string | number | null;
  readonly queuePosition?: number | null;
  readonly waitedMs?: number | null;
  readonly state?: string | null;
  readonly releaseCondition?: string | null;
  readonly eventDigests?: readonly string[];
}

export interface ReplayDashboardTicketObservation {
  readonly schemaId: 'atm.replayDashboardTicketObservation.v1';
  readonly participantId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly ticketId: string | null;
  readonly generation: string | null;
  readonly state: string;
  readonly queuePosition: number | null;
  readonly waitedMs: number;
  readonly releaseCondition: string;
  readonly eventDigests: readonly string[];
  readonly digest: string;
}

export interface ReplayDashboardTicketObservationSummary {
  readonly schemaId: 'atm.replayDashboardTicketObservationSummary.v1';
  readonly observationCount: number;
  readonly participantCount: number;
  readonly zeroWaitSafeComposeEligible: boolean;
  readonly missingReleaseConditionCount: number;
  readonly digest: string;
  readonly observations: readonly ReplayDashboardTicketObservation[];
}

export function buildTicketObservation(input: ReplayDashboardTicketObservationInput): ReplayDashboardTicketObservation {
  const withoutDigest = {
    schemaId: 'atm.replayDashboardTicketObservation.v1' as const,
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

export function summarizeTicketObservations(inputs: readonly ReplayDashboardTicketObservationInput[]): ReplayDashboardTicketObservationSummary {
  const observations = inputs.map(buildTicketObservation).sort((left, right) => left.participantId.localeCompare(right.participantId));
  const withoutDigest = {
    schemaId: 'atm.replayDashboardTicketObservationSummary.v1' as const,
    observationCount: observations.length,
    participantCount: new Set(observations.map((entry) => entry.participantId)).size,
    zeroWaitSafeComposeEligible: observations.length >= 2 && observations.every((entry) => entry.waitedMs === 0 && entry.state === 'execute-now'),
    missingReleaseConditionCount: observations.filter((entry) => entry.releaseCondition === 'not-observed').length,
    observations
  };
  return { ...withoutDigest, digest: digestJson(withoutDigest) };
}

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
