import { createHash } from 'node:crypto';

export interface ReplayDashboardLifecycleObservationInput {
  readonly participantId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly claimDigest?: string | null;
  readonly proposalDigest?: string | null;
  readonly composeBatchId?: string | null;
  readonly publishDigest?: string | null;
  readonly wakeup?: string | null;
  readonly validationDigest?: string | null;
  readonly closeDigest?: string | null;
  readonly lifecycleEvents?: readonly ReplayDashboardLifecycleEventInput[];
}

export interface ReplayDashboardLifecycleEventInput {
  readonly phase: string;
  readonly digest?: string | null;
  readonly status?: string | null;
  readonly waitedMs?: number | null;
}

export interface ReplayDashboardLifecycleObservation {
  readonly schemaId: 'atm.replayDashboardLifecycleObservation.v1';
  readonly participantId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly claimDigest: string | null;
  readonly proposalDigest: string | null;
  readonly composeBatchId: string | null;
  readonly publishDigest: string | null;
  readonly wakeup: string;
  readonly validationDigest: string | null;
  readonly closeDigest: string | null;
  readonly phases: readonly ReplayDashboardLifecyclePhase[];
  readonly complete: boolean;
  readonly waitedMs: number;
  readonly digest: string;
}

export interface ReplayDashboardLifecyclePhase {
  readonly phase: string;
  readonly digest: string | null;
  readonly status: string;
  readonly waitedMs: number;
}

export interface ReplayDashboardLifecycleObservationSummary {
  readonly schemaId: 'atm.replayDashboardLifecycleObservationSummary.v1';
  readonly observationCount: number;
  readonly participantCount: number;
  readonly composeBatchCount: number;
  readonly sharedComposeBatch: boolean;
  readonly completeCount: number;
  readonly zeroWaitSafeComposeEligible: boolean;
  readonly missingCloseCount: number;
  readonly digest: string;
  readonly observations: readonly ReplayDashboardLifecycleObservation[];
}

const REQUIRED_PHASES = ['claim', 'proposal', 'compose', 'publish', 'wakeup', 'validation', 'close'] as const;

export function buildLifecycleObservation(input: ReplayDashboardLifecycleObservationInput): ReplayDashboardLifecycleObservation {
  const explicitPhases = new Map((input.lifecycleEvents ?? []).map((event) => [normalizePhase(event.phase), event]));
  const phases = REQUIRED_PHASES.map((phase) => {
    const explicit = explicitPhases.get(phase);
    return {
      phase,
      digest: digestForPhase(input, phase, explicit),
      status: normalizeOptional(explicit?.status) ?? statusForPhase(input, phase),
      waitedMs: normalizeWait(explicit?.waitedMs)
    };
  });
  const withoutDigest = {
    schemaId: 'atm.replayDashboardLifecycleObservation.v1' as const,
    participantId: input.participantId,
    taskId: input.taskId,
    actorId: input.actorId,
    claimDigest: normalizeOptional(input.claimDigest),
    proposalDigest: normalizeOptional(input.proposalDigest),
    composeBatchId: normalizeOptional(input.composeBatchId),
    publishDigest: normalizeOptional(input.publishDigest),
    wakeup: normalizeOptional(input.wakeup) ?? 'not-observed',
    validationDigest: normalizeOptional(input.validationDigest),
    closeDigest: normalizeOptional(input.closeDigest),
    phases,
    complete: phases.every((phase) => phase.status === 'observed'),
    waitedMs: phases.reduce((total, phase) => total + phase.waitedMs, 0)
  };
  return { ...withoutDigest, digest: digestJson(withoutDigest) };
}

export function summarizeLifecycleObservations(
  inputs: readonly ReplayDashboardLifecycleObservationInput[]
): ReplayDashboardLifecycleObservationSummary {
  const observations = inputs.map(buildLifecycleObservation).sort((left, right) => left.participantId.localeCompare(right.participantId));
  const composeBatchIds = uniqueSorted(observations.map((entry) => entry.composeBatchId).filter(isString));
  const sharedComposeBatch = observations.length >= 2 && composeBatchIds.length === 1;
  const withoutDigest = {
    schemaId: 'atm.replayDashboardLifecycleObservationSummary.v1' as const,
    observationCount: observations.length,
    participantCount: new Set(observations.map((entry) => entry.participantId)).size,
    composeBatchCount: composeBatchIds.length,
    sharedComposeBatch,
    completeCount: observations.filter((entry) => entry.complete).length,
    zeroWaitSafeComposeEligible: sharedComposeBatch && observations.every((entry) => entry.complete && entry.waitedMs === 0),
    missingCloseCount: observations.filter((entry) => entry.closeDigest == null).length,
    observations
  };
  return { ...withoutDigest, digest: digestJson(withoutDigest) };
}

function digestForPhase(
  input: ReplayDashboardLifecycleObservationInput,
  phase: string,
  explicit?: ReplayDashboardLifecycleEventInput
): string | null {
  const explicitDigest = normalizeOptional(explicit?.digest);
  if (explicitDigest) return explicitDigest;
  if (phase === 'claim') return normalizeOptional(input.claimDigest);
  if (phase === 'proposal') return normalizeOptional(input.proposalDigest);
  if (phase === 'compose') return normalizeOptional(input.composeBatchId);
  if (phase === 'publish') return normalizeOptional(input.publishDigest);
  if (phase === 'validation') return normalizeOptional(input.validationDigest);
  if (phase === 'close') return normalizeOptional(input.closeDigest);
  return normalizeOptional(input.wakeup);
}

function statusForPhase(input: ReplayDashboardLifecycleObservationInput, phase: string): string {
  return digestForPhase(input, phase) == null ? 'not-observed' : 'observed';
}

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWait(value: unknown): number {
  return Math.max(0, typeof value === 'number' && Number.isFinite(value) ? value : 0);
}

function normalizePhase(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
