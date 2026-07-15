import { type CommandResult } from '../shared.ts';
export interface ReconcileEmergencyClassification {
    readonly schemaId: 'atm.reconcileEmergencyClassification.v1';
    readonly classification: 'clean-mirror-attestation' | 'local-closure-rewrite';
    readonly reasons: readonly string[];
}
/**
 * TASK-MEM-0008 (BUG-ATM-0072) — Policy Object: decide whether this reconcile
 * merely CREATES closure provenance for a clean imported-as-done mirror
 * (non-emergency) or would REWRITE existing local closure state (emergency).
 * Fail closed: any local closure artifact or live claim keeps the emergency
 * gate.
 */
export declare function classifyReconcileEmergency(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly taskDocument: Record<string, unknown>;
}): ReconcileEmergencyClassification;
export declare function runTasksReconcile(argv: string[]): Promise<CommandResult>;
