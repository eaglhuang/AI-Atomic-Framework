export type EmergencyPermissionId = 'backend.tasks.close' | 'backend.tasks.reconcile' | 'backend.tasks.import.write' | 'backend.tasks.repairClosure' | 'backend.tasks.reset' | 'backend.tasks.lockCleanupGlobal' | 'backend.tasks.scopeAmend' | 'backend.waiver.historicalDeliveryOutOfScope' | 'backend.runnerRecovery' | 'backend.gitHookBypass';
export interface EmergencyPermissionDefinition {
    readonly id: EmergencyPermissionId;
    readonly summary: string;
    readonly protectedSurfaces: readonly string[];
    readonly defaultTtlMinutes: number;
    readonly defaultMaxUses: number;
}
export declare const emergencyPermissionRegistry: readonly EmergencyPermissionDefinition[];
export declare function getEmergencyPermission(id: string): EmergencyPermissionDefinition | null;
export declare function listEmergencyPermissionIds(): string[];
