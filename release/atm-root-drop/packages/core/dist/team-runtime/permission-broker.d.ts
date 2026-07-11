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
export type BrokerConflictResolutionArtifact = {
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
    readonly currentAllowedTaskId: string | null;
    readonly blockedTaskIds: readonly string[];
    readonly artifactType: 'atm.brokerConflictResolution.v1';
    readonly statusCode: 'broker-conflict-blocked';
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
}): BrokerConflictResolutionArtifact;
export declare function decideBrokerConflictResolutionAdmission(artifact: BrokerConflictResolutionArtifact, taskId: string): BrokerConflictAdmissionDecision;
export declare function advanceBrokerConflictResolution(artifact: BrokerConflictResolutionArtifact, completedTaskId: string): BrokerConflictResolutionArtifact;
export declare function decideTeamPermission(policy: TeamPermissionPolicy, request: TeamPermissionRequest): TeamPermissionDecision;
