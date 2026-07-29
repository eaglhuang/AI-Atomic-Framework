import type {
  BrokerConflictGateResult,
  BrokerDecision,
  WriteBrokerRegistryDocument,
  WriteIntent
} from '../types.ts';

export type BrokerAdmissionDisposition =
  | 'direct'
  | 'proposal-required'
  | 'compose'
  | 'queue'
  | 'revalidate'
  | 'true-conflict';

export interface BrokerAdmissionRequest {
  readonly intent: WriteIntent;
}

export interface BrokerAdmissionPolicy {
  readonly preferProposalForBoundedWork?: boolean;
  readonly resolutionAuthorizedTaskIds?: ReadonlySet<string>;
  readonly evidenceRefs?: readonly string[];
  readonly startedAtMs?: number;
  readonly nowMs?: number;
}

export interface BrokerAdmissionTrace {
  readonly schemaId: 'atm.brokerAdmissionTrace.v1';
  readonly arbitrationVerdict: 'allow' | 'watch' | 'freeze' | 'takeover';
  readonly gates: readonly BrokerConflictGateResult[];
}

export interface BrokerAdmissionTicket {
  readonly schemaId: 'atm.brokerTicket.v1';
  readonly ticketId: string;
  readonly taskId: string;
  readonly state: 'execute-now' | 'proposal' | 'compose' | 'queue' | 'revalidate' | 'blocked';
}

export interface BrokerAdmissionCommandManifest {
  readonly schemaId: 'atm.commandManifest.v1';
  readonly action: 'execute' | 'submit-proposal' | 'compose' | 'wait' | 'revalidate' | 'resolve-conflict';
  readonly argv: readonly string[];
}

export interface BrokerAdmissionMetrics {
  readonly schemaId: 'atm.brokerAdmissionMetrics.v1';
  readonly decisionLatencyMs: number;
  readonly proposalRequests: number;
  readonly directAdmits: number;
  readonly composeAdmits: number;
  readonly trueConflicts: number;
  readonly queueDecisions: number;
  readonly revalidateDecisions: number;
  readonly manualInterventionCount: number;
}

export interface BrokerAdmissionResult {
  readonly schemaId: 'atm.brokerAdmissionResult.v1';
  readonly disposition: BrokerAdmissionDisposition;
  readonly decision: BrokerDecision;
  readonly decisionReason: string;
  readonly ticket: BrokerAdmissionTicket;
  readonly trace: BrokerAdmissionTrace;
  readonly commandManifests: readonly BrokerAdmissionCommandManifest[];
  readonly evidenceRefs: readonly string[];
  readonly metrics: BrokerAdmissionMetrics;
}

export type BrokerAdmissionRegistry = WriteBrokerRegistryDocument;
