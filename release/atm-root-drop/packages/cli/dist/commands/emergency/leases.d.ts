import { type EmergencyPermissionId } from './registry.ts';
export interface EmergencyMaintenanceLease {
    readonly schemaId: 'atm.emergencyMaintenanceLease.v1';
    readonly leaseId: string;
    readonly taskId: string | null;
    readonly actorId: string;
    readonly permission: EmergencyPermissionId;
    readonly approvedBy: string;
    readonly approvalText: string;
    readonly reason: string;
    readonly surface: string | null;
    readonly allowedFlags: readonly string[];
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly maxUses: number;
    readonly usedCount: number;
    readonly status: 'active' | 'revoked';
    readonly revokedAt?: string | null;
    readonly revokedBy?: string | null;
}
export interface EmergencyMaintenanceUse {
    readonly schemaId: 'atm.emergencyMaintenanceUse.v1';
    readonly leaseId: string;
    readonly taskId: string | null;
    readonly actorId: string | null;
    readonly permission: EmergencyPermissionId;
    readonly surface: string;
    readonly usedAt: string;
    readonly reason: string | null;
    readonly command: string | null;
    readonly result: 'authorized' | 'succeeded' | 'failed';
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
    readonly touchedFiles: readonly string[];
}
export declare function emergencyRoot(cwd: string): string;
export declare function createEmergencyLease(input: {
    readonly cwd: string;
    readonly taskId: string | null;
    readonly actorId: string;
    readonly permission: string;
    readonly approvedBy: string;
    readonly approvalText: string;
    readonly reason: string;
    readonly surface: string | null;
    readonly allowedFlags: readonly string[];
    readonly ttlMinutes: number | null;
    readonly maxUses: number | null;
}): {
    lease: EmergencyMaintenanceLease;
    path: string;
};
export declare function readEmergencyLease(cwd: string, leaseId: string): EmergencyMaintenanceLease;
export declare function listEmergencyLeases(cwd: string): EmergencyMaintenanceLease[];
export declare function revokeEmergencyLease(input: {
    readonly cwd: string;
    readonly leaseId: string;
    readonly actorId: string;
}): {
    lease: EmergencyMaintenanceLease;
    path: string;
};
export declare function consumeEmergencyLease(input: {
    readonly cwd: string;
    readonly leaseId: string;
    readonly permission: EmergencyPermissionId;
    readonly surface: string;
    readonly taskId: string | null;
    readonly actorId: string | null;
    readonly flags: readonly string[];
    readonly reason: string | null;
    readonly command: string | null;
    readonly before?: Record<string, unknown>;
    readonly after?: Record<string, unknown>;
    readonly touchedFiles?: readonly string[];
    readonly result?: 'authorized' | 'succeeded' | 'failed';
}): {
    lease: EmergencyMaintenanceLease;
    use: EmergencyMaintenanceUse;
    leasePath: string;
    usePath: string;
};
