/**
 * The only boundary allowed to consume a hook-bypass lease. It is invoked
 * after branch-queue admission and sealed candidate construction.
 */
export declare function executeHookBypassCommitBoundary(input: {
    readonly hookBypassRequest: Record<string, unknown> | null;
    readonly cwd: string;
    readonly gitArgs: readonly string[];
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
}): {
    value: string;
    protectedOverrideAudit: {
        lease: import("../../emergency/leases.ts").EmergencyMaintenanceLease;
        protectedOverrideAudit: null;
    } | {
        protectedOverrideAudit: {
            event: import("../../emergency/protected-override-audit.ts").ProtectedOverrideAuditEvent;
            eventPath: string;
        };
        lease: import("../../emergency/leases.ts").EmergencyMaintenanceLease;
        use: import("../../emergency/leases.ts").EmergencyMaintenanceUse;
        leasePath: string;
        usePath: string;
    } | null;
};
