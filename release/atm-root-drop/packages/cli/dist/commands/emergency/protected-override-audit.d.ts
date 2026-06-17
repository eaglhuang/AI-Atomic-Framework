import type { EmergencyPermissionId } from './registry.ts';
export type ProtectedOverrideOutcome = 'authorized' | 'succeeded' | 'failed';
export interface ProtectedOverrideRepairCandidate {
    readonly schemaId: 'atm.protectedOverrideRepairCandidate.v1';
    readonly summary: string;
    readonly suggestedCommand: string;
    readonly deferredChecks: readonly string[];
}
export interface ProtectedOverrideAuditEvent {
    readonly schemaId: 'atm.protectedOverrideAuditEvent.v1';
    readonly eventId: string;
    readonly recordedAt: string;
    readonly actorId: string | null;
    readonly taskId: string | null;
    readonly surface: string;
    readonly command: string | null;
    readonly flags: readonly string[];
    readonly permission: EmergencyPermissionId | string | null;
    readonly leaseId: string | null;
    readonly reason: string | null;
    readonly skippedChecks: readonly string[];
    readonly touchedFiles: readonly string[];
    readonly outcome: ProtectedOverrideOutcome;
    readonly failureCode: string | null;
    readonly emergencyUsePath: string | null;
    readonly parentEventId: string | null;
    readonly repairCandidate: ProtectedOverrideRepairCandidate | null;
}
export interface RecordProtectedOverrideInput {
    readonly cwd: string;
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
    readonly outcome: ProtectedOverrideOutcome;
    readonly failureCode?: string | null;
    readonly emergencyUsePath?: string | null;
    readonly parentEventId?: string | null;
    readonly repairCandidate?: ProtectedOverrideRepairCandidate | null;
}
export declare function protectedOverrideAuditRoot(cwd: string): string;
export declare function buildProtectedOverrideRepairCandidate(input: {
    readonly summary: string;
    readonly suggestedCommand: string;
    readonly deferredChecks?: readonly string[];
}): ProtectedOverrideRepairCandidate;
export declare function recordProtectedOverrideAuditEvent(input: RecordProtectedOverrideInput): {
    event: ProtectedOverrideAuditEvent;
    eventPath: string;
};
export declare function recordProtectedOverrideAuthorization(input: Omit<RecordProtectedOverrideInput, 'outcome'> & {
    readonly outcome?: 'authorized';
}): ReturnType<typeof recordProtectedOverrideAuditEvent>;
export declare function recordProtectedOverrideCompletion(input: Omit<RecordProtectedOverrideInput, 'outcome'> & {
    readonly parentEventId: string;
    readonly outcome: 'succeeded' | 'failed';
}): ReturnType<typeof recordProtectedOverrideAuditEvent>;
export declare function listProtectedOverrideAuditEvents(cwd: string, input?: {
    readonly taskId?: string | null;
    readonly leaseId?: string | null;
    readonly limit?: number;
}): ProtectedOverrideAuditEvent[];
export declare function recordFailedProtectedOverrideAttempt(input: {
    readonly cwd: string;
    readonly leaseId: string | null | undefined;
    readonly permission: EmergencyPermissionId;
    readonly surface: string;
    readonly taskId: string | null;
    readonly actorId: string | null;
    readonly reason: string | null;
    readonly command: string | null;
    readonly flags?: readonly string[];
    readonly skippedChecks?: readonly string[];
    readonly failureCode: string | null;
}): string | null;
