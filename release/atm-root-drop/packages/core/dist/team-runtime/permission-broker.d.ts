import { type BrokerTicketAuthorizationResourceKind, type BrokerTicketGate, type BrokerTicketOperation, type BrokerTicketWithAuthority } from '../broker/ticket-authority/index.js';
export type TeamPermissionPolicy = {
    readonly schemaId: 'atm.teamPermissionPolicy.v1';
    readonly repoPolicyId: string;
    /** Every provider permission decision is fail-closed and must pass this gate. */
    readonly hardGate: true;
    readonly allowedPermissions: readonly string[];
    readonly vendorPermissions: Readonly<Record<string, readonly string[]>>;
    readonly defaultDecision: 'deny' | 'allow';
};
export type TeamPermissionRequest = {
    readonly permission: string;
    readonly providerId: string;
    readonly scopedPaths: readonly string[];
};
export type TeamPermissionDecision = {
    readonly ok: boolean;
    readonly hardGate: true;
    readonly gateId: 'ATM_TEAM_PERMISSION_HARD_GATE';
    readonly reason: string;
    readonly permission: string;
    readonly providerId: string;
};
export type BrokerConflictDecisionClass = 'serial-release' | 'human-signoff-required' | 'adr-required' | 'blocked';
export type BrokerConflictViolationStatus = 'broker-conflict-blocked' | 'resolution-issued' | 'resolved';
/**
 * ATM-GOV-0255: the authority envelope a `broker-conflict-blocked` resolution
 * must carry so `readResolutionAuthorizedForeignTaskIds` can admit a retry
 * without a manual `.atm/runtime` edit or a generic emergency override.
 */
export type BrokerConflictResolutionAuthority = {
    readonly brokerTicket: BrokerTicketWithAuthority;
    readonly authorityGeneration: number;
    readonly authorityDigest: string;
    readonly conflictFiles: readonly string[];
    readonly authorizationResourceKind: BrokerTicketAuthorizationResourceKind;
    readonly authorizationOperation: BrokerTicketOperation;
    readonly authorizationGate: BrokerTicketGate;
};
export type BrokerConflictResolutionArtifact = BrokerConflictResolutionAuthority & {
    readonly schemaId: 'atm.brokerConflictResolution.v1';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly resolutionId: string;
    readonly createdAt: string;
    readonly primaryTaskId: string;
    readonly conflictingTaskIds: readonly string[];
    readonly sharedPaths: readonly string[];
    readonly decisionClass: BrokerConflictDecisionClass;
    readonly decisionReason: string;
    readonly violationStatus: BrokerConflictViolationStatus;
    readonly releaseOrder: readonly string[];
    readonly validatorPlan: readonly string[];
    readonly currentAllowedTaskId: string | null;
    readonly blockedTaskIds: readonly string[];
    readonly artifactType: 'atm.brokerConflictResolution.v1';
    readonly statusCode: 'broker-conflict-blocked';
};
export type BrokerConflictResolutionAuthorizationReason = 'authorized' | 'missing-broker-ticket' | 'no-bounded-resource-keys' | 'task-mismatch' | 'terminal-ticket' | 'stale-generation' | 'authority-digest-mismatch' | 'resource-dimension-mismatch' | 'resource-key-mismatch' | 'operation-mismatch' | 'gate-mismatch';
export type BrokerConflictResolutionAuthorizationCheck = {
    readonly authorized: boolean;
    readonly reason: BrokerConflictResolutionAuthorizationReason;
};
export type BrokerConflictAdmissionDecision = {
    readonly ok: boolean;
    readonly taskId: string;
    readonly decisionClass: BrokerConflictDecisionClass;
    readonly decisionReason: string;
    readonly violationStatus: BrokerConflictViolationStatus;
    readonly statusCode: 'broker-conflict-blocked' | 'resolved';
};
export declare function createDefaultTeamPermissionPolicy(): TeamPermissionPolicy;
export declare function createBrokerConflictResolutionArtifact(input: {
    readonly primaryTaskId: string;
    readonly conflictingTaskIds: readonly string[];
    readonly sharedPaths: readonly string[];
    readonly decisionClass?: BrokerConflictDecisionClass;
    readonly decisionReason: string;
    readonly violationStatus?: BrokerConflictViolationStatus;
    readonly releaseOrder?: readonly string[];
    readonly createdAt?: string;
    readonly actorId?: string;
    readonly conflictFiles?: readonly string[];
    readonly authorizationResourceKind?: BrokerTicketAuthorizationResourceKind;
    readonly authorizationOperation?: BrokerTicketOperation;
    readonly authorizationGate?: BrokerTicketGate;
}): BrokerConflictResolutionArtifact;
/**
 * Canonical consumer-side authority check. This is the single validator
 * shared by claim admission (`readResolutionAuthorizedForeignTaskIds`) and
 * any other consumer of `atm.brokerConflictResolution.v1`; it must never be
 * reimplemented against a divergent contract. Fails closed (returns a
 * specific non-`authorized` reason, never a silent permissive default) for
 * missing, stale, over-broad, differently ordered, or resource-mismatched
 * artifacts, including pre-ATM-GOV-0255 legacy artifacts that carry no
 * `brokerTicket` at all.
 */
export declare function evaluateBrokerConflictResolutionAuthority(artifact: Record<string, unknown>, taskId: string): BrokerConflictResolutionAuthorizationCheck;
export declare function decideBrokerConflictResolutionAdmission(artifact: BrokerConflictResolutionArtifact, taskId: string): BrokerConflictAdmissionDecision;
export declare function advanceBrokerConflictResolution(artifact: BrokerConflictResolutionArtifact, completedTaskId: string): BrokerConflictResolutionArtifact;
export declare function decideTeamPermission(policy: TeamPermissionPolicy, request: TeamPermissionRequest): TeamPermissionDecision;
