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
/** Stable top-level key order; the atomization regression pins this list. */
export const CLAIM_ADMISSION_DECISION_LOG_KEYS = [
    'schemaId',
    'taskId',
    'conflictTaskId',
    'gates',
    'sharedPathOrder',
    'queue',
    'privatePathAllowance',
    'admitted',
    'blockReason',
    'admissionReason'
];
/** The seven gate names, in fixed evaluation order; regressions pin this. */
export const CLAIM_ADMISSION_GATE_NAMES = [
    'claim-intent',
    'active-write-conflict',
    'broker-confirmation',
    'mutation-intent',
    'cid-verdict',
    'queue-admission',
    'broker-verdict'
];
function normalizeSharedPathOrder(paths) {
    return [...new Set(paths.map((value) => String(value).trim().replace(/\\/g, '/')).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
export function buildClaimAdmissionDecisionLog(input) {
    const queueStatus = input.queueAdmission?.status ?? 'not-evaluated';
    const waitingOn = input.queueAdmission?.waitingOn ?? [];
    const queuePosition = waitingOn.length > 0
        ? Math.min(...waitingOn.map((entry) => entry.position))
        : (queueStatus === 'queue-head' ? 1 : null);
    const privateGranted = queueStatus === 'queued-private-work';
    const gates = [
        {
            gate: 'claim-intent',
            outcome: input.claimIntent,
            detail: input.claimIntent === 'closeout-only'
                ? 'closeout-only claims bypass parallel CID write blocking'
                : 'write-intent claim is subject to the full gate chain'
        },
        {
            gate: 'active-write-conflict',
            outcome: input.activeWriteConflict ? 'conflict' : 'clear',
            detail: input.activeWriteConflict
                ? `an active write claim by another actor overlaps ${input.conflictTaskId ?? 'another task'}`
                : 'no other actor holds an active write claim on the overlap'
        },
        {
            gate: 'broker-confirmation',
            outcome: input.confirmedBrokerConflict ? 'confirmed' : 'unconfirmed',
            detail: input.confirmedBrokerConflict
                ? 'the Broker confirmed an ownership conflict on the shared surface'
                : 'the Broker did not confirm an ownership conflict'
        },
        {
            gate: 'mutation-intent',
            outcome: input.insufficientMutationIntent ? 'insufficient' : 'sufficient',
            detail: input.insufficientMutationIntent
                ? 'the overlap lacks a confirmed Broker mutation intent or resolution artifact'
                : 'mutation intent evidence is sufficient for arbitration'
        },
        {
            gate: 'cid-verdict',
            outcome: input.cidVerdict,
            detail: 'legacy CID diagnostic; divergence from the broker verdict is surfaced, not gated on'
        },
        {
            gate: 'queue-admission',
            outcome: queueStatus,
            detail: input.queueAdmission?.reason ?? 'no canonical shared-surface queue was consulted for this candidate'
        },
        {
            gate: 'broker-verdict',
            outcome: input.brokerVerdict,
            detail: input.decision.admitted
                ? 'broker arbitration admits the claim'
                : 'broker arbitration freezes the claim until the conflict is resolved'
        }
    ];
    return {
        schemaId: 'atm.nextClaimAdmissionDecisionLog.v1',
        taskId: input.taskId,
        conflictTaskId: input.conflictTaskId,
        gates,
        sharedPathOrder: normalizeSharedPathOrder(input.overlappingFiles),
        queue: {
            status: queueStatus,
            position: queuePosition,
            waitingOn
        },
        privatePathAllowance: {
            granted: privateGranted,
            allowedFileCount: input.queueAdmission?.allowedFiles.length ?? 0
        },
        admitted: input.decision.admitted,
        blockReason: input.decision.blockReason,
        admissionReason: input.admissionReason
    };
}
