/**
 * Closure assurance reducer.
 *
 * Quality assurance for a checkpoint is a long-lived, resumable question: some
 * obligations are proven, some are still open, some can never be exercised, and
 * occasionally one is actively refuted. Modelling that as a mutable status field
 * loses the middle — a run that stops is either "pass" or "fail" and the partial
 * progress disappears with it.
 *
 * This module models it as an append-only event stream reduced to a public view.
 * The reducer is deterministic and idempotent: the same events in the same run
 * always produce the same view, and re-applying an event that was already seen
 * is reported rather than counted twice. That is what makes a run replayable
 * from its recorded events instead of from the process that produced them.
 *
 * Nothing here reads the file system, a clock, or a validator. Callers reach it
 * through the `QualityGauntlet` facade; downstream selectors read the events.
 */
export declare const CLOSURE_ASSURANCE_MACHINE_ID: "atm.closureAssuranceMachine.v1";
export declare const CLOSURE_ASSURANCE_VIEW_SCHEMA_ID: "atm.closureAssuranceView.v1";
export declare const QUALITY_GAUNTLET_EVENT_SCHEMA_ID: "atm.qualityGauntletEvent.v1";
export type QualityGauntletEventKind = 'assurance-started' | 'obligation-observed' | 'validator-progress' | 'counterexample-found' | 'assurance-indeterminate' | 'assurance-stopped';
export type QualityGauntletEventOutcome = 'pass' | 'fail' | 'skipped' | 'excluded' | 'unknown';
/**
 * `running` is the only non-terminal state. The four terminal states are kept
 * distinct on purpose: "we proved it", "what is left can never be exercised",
 * "we have a counterexample", and "we could not tell" are different answers to
 * a closeback question, and collapsing them loses the reason.
 */
export type ClosureAssuranceState = 'running' | 'stopped-proven' | 'stopped-sufficient' | 'blocked-counterexample' | 'indeterminate';
export type ClosureAssuranceVerdict = 'in-progress' | 'proven' | 'sufficient' | 'blocked' | 'indeterminate';
export type ClosureAssuranceObligationStatus = 'pending' | 'covered' | 'excluded' | 'counterexample' | 'unknown';
export type ClosureAssuranceDiagnosticCode = 'ATM_ASSURANCE_DUPLICATE_EVENT' | 'ATM_ASSURANCE_EVENT_AFTER_TERMINAL' | 'ATM_ASSURANCE_RUN_MISMATCH' | 'ATM_ASSURANCE_UNKNOWN_OBLIGATION' | 'ATM_ASSURANCE_STOP_WITH_OPEN_OBLIGATIONS';
/**
 * The public event contract. Every field is readable by downstream selection
 * without touching reducer state, which is what lets validator catalog work
 * consume a run without coupling to how the run was computed.
 */
export interface QualityGauntletEvent {
    readonly schemaId: typeof QUALITY_GAUNTLET_EVENT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    /** Canonical digest of the payload: identical observations are one event. */
    readonly eventId: string;
    readonly kind: QualityGauntletEventKind;
    readonly runId: string;
    readonly checkpoint: string;
    readonly occurredAt: string;
    readonly obligationId: string | null;
    readonly semanticFamily: string | null;
    readonly owningSeam: string | null;
    readonly validatorCommand: string | null;
    readonly validatorCaseId: string | null;
    readonly outcome: QualityGauntletEventOutcome | null;
    readonly detail: string | null;
}
export interface QualityGauntletEventInput {
    readonly kind: QualityGauntletEventKind;
    readonly runId: string;
    readonly checkpoint: string;
    readonly occurredAt: string;
    readonly obligationId?: string | null;
    readonly semanticFamily?: string | null;
    readonly owningSeam?: string | null;
    readonly validatorCommand?: string | null;
    readonly validatorCaseId?: string | null;
    readonly outcome?: QualityGauntletEventOutcome | null;
    readonly detail?: string | null;
}
export interface ClosureAssuranceObligationProgress {
    readonly obligationId: string;
    readonly semanticFamily: string | null;
    readonly owningSeam: string | null;
    readonly status: ClosureAssuranceObligationStatus;
    readonly validatorCommands: readonly string[];
}
export interface ClosureAssuranceDiagnostic {
    readonly code: ClosureAssuranceDiagnosticCode;
    readonly eventId: string | null;
    readonly kind: QualityGauntletEventKind | null;
    readonly detail: string;
}
export interface ClosureAssuranceCounterexample {
    readonly obligationId: string | null;
    readonly validatorCommand: string | null;
    readonly detail: string | null;
    readonly observedAt: string;
}
export interface ClosureAssuranceProgress {
    readonly total: number;
    readonly covered: number;
    readonly pending: number;
    readonly unknown: number;
    readonly excluded: number;
    readonly counterexample: number;
}
export interface ClosureAssuranceView {
    readonly schemaId: typeof CLOSURE_ASSURANCE_VIEW_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly machineId: typeof CLOSURE_ASSURANCE_MACHINE_ID;
    readonly runId: string;
    readonly checkpoint: string;
    readonly state: ClosureAssuranceState;
    readonly verdict: ClosureAssuranceVerdict;
    readonly terminal: boolean;
    readonly obligations: readonly ClosureAssuranceObligationProgress[];
    readonly counterexamples: readonly ClosureAssuranceCounterexample[];
    readonly progress: ClosureAssuranceProgress;
    readonly appliedEventIds: readonly string[];
    readonly duplicateEventIds: readonly string[];
    readonly diagnostics: readonly ClosureAssuranceDiagnostic[];
    readonly viewDigest: string;
}
export declare function createQualityGauntletEvent(input: QualityGauntletEventInput): QualityGauntletEvent;
/**
 * Reduce a recorded stream into the public view. This is the whole semantic
 * definition of a run: `ClosureAssuranceMachine` is a thin incremental wrapper
 * over it, so live and replayed runs cannot drift apart.
 */
export declare function reduceClosureAssurance(input: {
    readonly runId: string;
    readonly checkpoint: string;
    readonly events: readonly QualityGauntletEvent[];
}): ClosureAssuranceView;
export declare class ClosureAssuranceMachine {
    #private;
    constructor(init: {
        readonly runId: string;
        readonly checkpoint: string;
    });
    /** Apply one event and return the view it produces. Never throws on a bad event. */
    apply(event: QualityGauntletEvent): ClosureAssuranceView;
    view(): ClosureAssuranceView;
    /** The recorded stream, in the order it was applied. */
    events(): readonly QualityGauntletEvent[];
}
