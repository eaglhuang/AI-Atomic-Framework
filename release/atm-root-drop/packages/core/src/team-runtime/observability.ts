import type { BrokerConflictResolutionArtifact } from './permission-broker.ts';
import type { TeamProviderId } from './provider-contract.ts';

export type TeamObservabilityEventType =
  | 'session.start'
  | 'step.execution'
  | 'tool.invocation'
  | 'artifact.output'
  | 'session.complete'
  | 'session.failure'
  | 'broker.conflict.blocked'
  | 'broker.conflict.resolution'
  | 'handoff.materialized'
  | 'handoff.consumed'
  | 'handoff.integrity-blocked'
  | 'handoff.archived';

export type TeamRuntimeMode = 'real-agent' | 'editor-subagent' | 'broker-only';

export type TeamObservabilityEvent = {
  readonly schemaId: 'atm.teamAgentObservabilityEvent.v1';
  readonly specVersion: '0.1.0';
  readonly eventId: string;
  readonly emittedAt: string;
  readonly eventType: TeamObservabilityEventType;
  readonly taskId: string;
  readonly teamRunId: string | null;
  readonly providerId: TeamProviderId | 'unknown';
  readonly role: string;
  readonly runtimeMode: TeamRuntimeMode;
  readonly artifactType: string | null;
  readonly artifactId: string | null;
  readonly decisionClass: string | null;
  readonly decisionReason: string | null;
  readonly violationStatus: string | null;
  readonly statusCode: string | null;
  readonly summary: string;
  readonly redaction: {
    readonly rawSecretsLogged: false;
    readonly redactedFields: readonly string[];
  };
  readonly evidenceBoundary: {
    readonly governanceEvidenceOnly: true;
    readonly rawSecretsAllowed: false;
  };
};

export type TeamObservabilityQuery = {
  readonly taskId?: string;
  readonly teamRunId?: string;
  readonly providerId?: string;
  readonly role?: string;
  readonly artifactType?: string;
  readonly eventType?: TeamObservabilityEventType;
};

export type TeamObservabilityQueryResult = {
  readonly schemaId: 'atm.teamAgentObservabilityQueryResult.v1';
  readonly specVersion: '0.1.0';
  readonly filters: TeamObservabilityQuery;
  readonly eventCount: number;
  readonly events: readonly TeamObservabilityEvent[];
};

export function buildTeamObservabilityContract() {
  return {
    schemaId: 'atm.teamAgentObservabilityContract.v1',
    eventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
    queryResultSchemaId: 'atm.teamAgentObservabilityQueryResult.v1',
    providerNeutral: true,
    queryKeys: ['taskId', 'teamRunId', 'providerId', 'role', 'artifactType', 'eventType'],
    eventTypes: [
      'session.start',
      'step.execution',
      'tool.invocation',
      'artifact.output',
      'session.complete',
      'session.failure',
      'broker.conflict.blocked',
      'broker.conflict.resolution',
      'handoff.materialized',
      'handoff.consumed',
      'handoff.integrity-blocked',
      'handoff.archived'
    ] as const,
    brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    redactionPolicy: {
      rawSecretsLogged: false,
      rawSecretsAllowed: false,
      governanceEvidenceOnly: true
    }
  } as const;
}

export function createTeamObservabilityEvent(input: {
  readonly eventType: TeamObservabilityEventType;
  readonly taskId: string;
  readonly teamRunId?: string | null;
  readonly providerId?: TeamProviderId | 'unknown';
  readonly role: string;
  readonly runtimeMode?: TeamRuntimeMode;
  readonly artifactType?: string | null;
  readonly artifactId?: string | null;
  readonly decisionClass?: string | null;
  readonly decisionReason?: string | null;
  readonly violationStatus?: string | null;
  readonly statusCode?: string | null;
  readonly summary: string;
  readonly emittedAt?: string;
  readonly redactedFields?: readonly string[];
}): TeamObservabilityEvent {
  const emittedAt = input.emittedAt?.trim() || new Date().toISOString();
  const taskId = normalizeRequired(input.taskId, 'taskId');
  const role = normalizeRequired(input.role, 'role');
  const providerId = input.providerId ?? 'unknown';
  const artifactType = nullableString(input.artifactType);
  const artifactId = nullableString(input.artifactId);
  const decisionClass = nullableString(input.decisionClass);
  const violationStatus = nullableString(input.violationStatus);

  return {
    schemaId: 'atm.teamAgentObservabilityEvent.v1',
    specVersion: '0.1.0',
    eventId: `TAO-${stableSuffix([
      input.eventType,
      taskId,
      String(input.teamRunId ?? ''),
      providerId,
      role,
      artifactType ?? '',
      artifactId ?? '',
      emittedAt
    ])}`,
    emittedAt,
    eventType: input.eventType,
    taskId,
    teamRunId: nullableString(input.teamRunId),
    providerId,
    role,
    runtimeMode: input.runtimeMode ?? 'broker-only',
    artifactType,
    artifactId,
    decisionClass,
    decisionReason: nullableString(input.decisionReason),
    violationStatus,
    statusCode: nullableString(input.statusCode),
    summary: normalizeRequired(input.summary, 'summary'),
    redaction: {
      rawSecretsLogged: false,
      redactedFields: [...(input.redactedFields ?? [])]
    },
    evidenceBoundary: {
      governanceEvidenceOnly: true,
      rawSecretsAllowed: false
    }
  };
}

export function createBrokerConflictObservabilityEvents(input: {
  readonly artifact: BrokerConflictResolutionArtifact;
  readonly providerId?: TeamProviderId | 'unknown';
  readonly role?: string;
  readonly teamRunId?: string | null;
  readonly emittedAt?: string;
}): TeamObservabilityEvent[] {
  const { artifact } = input;
  const base = {
    taskId: artifact.primaryTaskId,
    teamRunId: input.teamRunId ?? null,
    providerId: input.providerId ?? 'unknown',
    role: input.role ?? 'coordinator',
    runtimeMode: 'broker-only' as const,
    artifactType: artifact.artifactType,
    artifactId: artifact.resolutionId,
    decisionClass: artifact.decisionClass,
    decisionReason: artifact.decisionReason,
    violationStatus: artifact.violationStatus,
    statusCode: artifact.statusCode,
    emittedAt: input.emittedAt
  };

  return [
    createTeamObservabilityEvent({
      ...base,
      eventType: 'broker.conflict.blocked',
      summary: `broker-conflict-blocked for ${artifact.primaryTaskId}; blocked=${artifact.blockedTaskIds.join(',') || 'none'}`
    }),
    createTeamObservabilityEvent({
      ...base,
      eventType: 'broker.conflict.resolution',
      summary: `resolution ${artifact.resolutionId} release order: ${artifact.releaseOrder.join(' -> ')}`
    })
  ];
}

export function queryTeamObservabilityEvents(
  events: readonly TeamObservabilityEvent[],
  filters: TeamObservabilityQuery
): TeamObservabilityQueryResult {
  const normalizedFilters = normalizeQuery(filters);
  const matching = events.filter((event) => {
    return matches(event.taskId, normalizedFilters.taskId)
      && matches(event.teamRunId, normalizedFilters.teamRunId)
      && matches(event.providerId, normalizedFilters.providerId)
      && matches(event.role, normalizedFilters.role)
      && matches(event.artifactType, normalizedFilters.artifactType)
      && matches(event.eventType, normalizedFilters.eventType);
  });

  return {
    schemaId: 'atm.teamAgentObservabilityQueryResult.v1',
    specVersion: '0.1.0',
    filters: normalizedFilters,
    eventCount: matching.length,
    events: matching
  };
}

function normalizeQuery(filters: TeamObservabilityQuery): TeamObservabilityQuery {
  return Object.fromEntries(
    Object.entries(filters)
      .map(([key, value]) => [key, String(value ?? '').trim()])
      .filter(([, value]) => Boolean(value))
  ) as TeamObservabilityQuery;
}

function matches(value: string | null, expected: string | undefined): boolean {
  return !expected || value === expected;
}

function nullableString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeRequired(value: unknown, fieldName: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required for Team observability events.`);
  }
  return normalized;
}

function stableSuffix(values: readonly string[]): string {
  let hash = 0;
  for (const value of values.join('|')) {
    hash = ((hash << 5) - hash + value.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(6, '0');
}
