import type { BrokerConflictResolutionArtifact } from './permission-broker.ts';
import type { TeamProviderId } from './provider-contract.ts';
export type TeamObservabilityEventType = 'session.start' | 'step.execution' | 'tool.invocation' | 'artifact.output' | 'session.complete' | 'session.failure' | 'broker.conflict.blocked' | 'broker.conflict.resolution';
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
export declare function buildTeamObservabilityContract(): {
    readonly schemaId: "atm.teamAgentObservabilityContract.v1";
    readonly eventSchemaId: "atm.teamAgentObservabilityEvent.v1";
    readonly queryResultSchemaId: "atm.teamAgentObservabilityQueryResult.v1";
    readonly providerNeutral: true;
    readonly queryKeys: readonly ["taskId", "teamRunId", "providerId", "role", "artifactType", "eventType"];
    readonly eventTypes: readonly ["session.start", "step.execution", "tool.invocation", "artifact.output", "session.complete", "session.failure", "broker.conflict.blocked", "broker.conflict.resolution"];
    readonly brokerConflictVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
    readonly redactionPolicy: {
        readonly rawSecretsLogged: false;
        readonly rawSecretsAllowed: false;
        readonly governanceEvidenceOnly: true;
    };
};
export declare function createTeamObservabilityEvent(input: {
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
}): TeamObservabilityEvent;
export declare function createBrokerConflictObservabilityEvents(input: {
    readonly artifact: BrokerConflictResolutionArtifact;
    readonly providerId?: TeamProviderId | 'unknown';
    readonly role?: string;
    readonly teamRunId?: string | null;
    readonly emittedAt?: string;
}): TeamObservabilityEvent[];
export declare function queryTeamObservabilityEvents(events: readonly TeamObservabilityEvent[], filters: TeamObservabilityQuery): TeamObservabilityQueryResult;
