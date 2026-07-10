export type EmergencyPermissionId = 'backend.tasks.close' | 'backend.tasks.reconcile' | 'backend.tasks.import.write' | 'backend.tasks.repairClosure' | 'backend.tasks.reset' | 'backend.tasks.lockCleanupGlobal' | 'backend.tasks.scopeAmend' | 'backend.waiver.historicalDeliveryOutOfScope' | 'backend.runnerRecovery' | 'backend.brokerConflictOverride' | 'backend.gitHookBypass';
export interface EmergencyPermissionDefinition {
    readonly id: EmergencyPermissionId;
    readonly summary: string;
    readonly protectedSurfaces: readonly string[];
    readonly normalLane: string;
    readonly riskTier: 'medium' | 'high' | 'critical';
    readonly defaultTtlMinutes: number;
    readonly defaultMaxUses: number;
    readonly requiresTaskId: boolean;
    readonly requiresActor: boolean;
    readonly requiresHumanApprovalText: boolean;
    readonly auditRequired: boolean;
    readonly validatorTags: readonly string[];
}
export declare const emergencyPermissionRegistry: readonly EmergencyPermissionDefinition[];
export declare function getEmergencyPermission(id: string): EmergencyPermissionDefinition | null;
export declare function listEmergencyPermissionIds(): string[];
