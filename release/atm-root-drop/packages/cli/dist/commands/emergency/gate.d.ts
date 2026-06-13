import type { EmergencyPermissionId } from './registry.ts';
export interface EmergencyGateInput {
    readonly cwd: string;
    readonly surface: string;
    readonly permission: EmergencyPermissionId;
    readonly taskId?: string | null;
    readonly actorId?: string | null;
    readonly emergencyApproval?: string | null;
    readonly flags?: readonly string[];
    readonly reason?: string | null;
    readonly command?: string | null;
    readonly allowTaskflowOperatorLane?: boolean;
}
export declare function assertEmergencyApproval(input: EmergencyGateInput): {
    lease: import("./leases.ts").EmergencyMaintenanceLease;
    use: import("./leases.ts").EmergencyMaintenanceUse;
    leasePath: string;
    usePath: string;
} | null;
