import { type ProtectedOverrideRepairCandidate } from './protected-override-audit.ts';
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
export declare function recordProtectedOverrideOutcome(input: {
    readonly cwd: string;
    readonly parentEventId: string;
    readonly actorId: string | null;
    readonly taskId: string | null;
    readonly surface: string;
    readonly command: string | null;
    readonly flags?: readonly string[];
    readonly permission?: EmergencyPermissionId | string | null;
    readonly leaseId?: string | null;
    readonly reason?: string | null;
    readonly skippedChecks?: readonly string[];
    readonly touchedFiles?: readonly string[];
    readonly outcome: 'succeeded' | 'failed';
    readonly failureCode?: string | null;
    readonly emergencyUsePath?: string | null;
    readonly repairCandidate?: ProtectedOverrideRepairCandidate | null;
}): {
    event: import("./protected-override-audit.ts").ProtectedOverrideAuditEvent;
    eventPath: string;
};
export declare function assertEmergencyApproval(input: EmergencyGateInput): {
    protectedOverrideAudit: {
        event: import("./protected-override-audit.ts").ProtectedOverrideAuditEvent;
        eventPath: string;
    };
    lease: import("./leases.ts").EmergencyMaintenanceLease;
    use: import("./leases.ts").EmergencyMaintenanceUse;
    leasePath: string;
    usePath: string;
} | null;
