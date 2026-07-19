/**
 * TASK-TEAM-0078 — next.claim.admission structured decision log atom.
 *
 * Single owner module for the structured admission log. Every `next --claim`
 * candidate decision is rendered into one deterministic
 * `atm.nextClaimAdmissionDecisionLog.v1` record that explains the seven-layer
 * gate result, the shared-path evaluation order, the queue position, the
 * private-path allowance, and the block reason — without echoing any task
 * body content. `next.ts` only assembles inputs and attaches the record; the
 * schema and rendering live here so regressions can pin the shape.
 */
import type { BrokerArbitrationVerdict } from '../../../../core/src/broker/conflict-matrix.ts';
import type { ClaimAdmissionCidVerdict, ClaimAdmissionDecision, ClaimOwnerComparison } from './claim-admission.ts';
import type { BrokerQueueAdmission } from './broker-queue-admission.ts';
export interface ClaimAdmissionGateOutcome {
    readonly gate: string;
    readonly outcome: string;
    readonly detail: string;
}
export interface ClaimAdmissionDecisionLog {
    readonly schemaId: 'atm.nextClaimAdmissionDecisionLog.v1';
    readonly taskId: string;
    readonly conflictTaskId: string | null;
    /** Seven-layer gate result, in fixed evaluation order. */
    readonly gates: readonly ClaimAdmissionGateOutcome[];
    /** Deterministic (sorted, normalized) order shared paths were evaluated in. */
    readonly sharedPathOrder: readonly string[];
    readonly queue: {
        readonly status: BrokerQueueAdmission['status'] | 'not-evaluated';
        readonly position: number | null;
        readonly waitingOn: readonly {
            readonly surfacePath: string;
            readonly queueHeadTaskId: string;
            readonly position: number;
        }[];
    };
    readonly ownerComparison: ClaimOwnerComparison | null;
    readonly privatePathAllowance: {
        readonly granted: boolean;
        readonly allowedFileCount: number;
    };
    readonly admitted: boolean;
    readonly blockReason: string | null;
    readonly admissionReason: string | null;
}
/** Stable top-level key order; the atomization regression pins this list. */
export declare const CLAIM_ADMISSION_DECISION_LOG_KEYS: readonly ["schemaId", "taskId", "conflictTaskId", "gates", "sharedPathOrder", "queue", "ownerComparison", "privatePathAllowance", "admitted", "blockReason", "admissionReason"];
/** The seven gate names, in fixed evaluation order; regressions pin this. */
export declare const CLAIM_ADMISSION_GATE_NAMES: readonly ["claim-intent", "active-write-conflict", "broker-confirmation", "mutation-intent", "cid-verdict", "queue-admission", "broker-verdict"];
export interface ClaimAdmissionDecisionLogInput {
    readonly taskId: string;
    readonly conflictTaskId: string | null;
    readonly claimIntent: string;
    readonly activeWriteConflict: boolean;
    readonly confirmedBrokerConflict: boolean;
    readonly insufficientMutationIntent: boolean;
    readonly cidVerdict: ClaimAdmissionCidVerdict;
    readonly brokerVerdict: BrokerArbitrationVerdict;
    readonly queueAdmission: BrokerQueueAdmission | null;
    readonly overlappingFiles: readonly string[];
    readonly decision: ClaimAdmissionDecision;
    readonly ownerComparison?: ClaimOwnerComparison | null;
    readonly admissionReason: string | null;
}
export declare function buildClaimAdmissionDecisionLog(input: ClaimAdmissionDecisionLogInput): ClaimAdmissionDecisionLog;
