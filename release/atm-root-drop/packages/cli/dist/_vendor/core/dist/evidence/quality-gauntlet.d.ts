/**
 * Quality gauntlet facade.
 *
 * Close, check-in, phase and release checkpoints all need the same thing: "may
 * this proceed, and on what evidence?". They must not each learn how assurance
 * is computed. This facade is the whole caller-facing surface — `advance` moves
 * one run forward, `inspect` reads its public view and event log, and `replay`
 * rebuilds a view from recorded events alone.
 *
 * Everything behind it is the `ClosureAssuranceMachine` event stream. The facade
 * translates a caller's request into events and never exposes reducer state, so
 * later selection, freshness and certificate work can consume the events without
 * coupling to how a verdict was reached.
 */
import { type ClosureAssuranceState, type ClosureAssuranceVerdict, type ClosureAssuranceView, type QualityGauntletEvent } from './closure-assurance-machine.js';
export declare const QUALITY_GAUNTLET_ID: "atm.qualityGauntlet.v1";
export declare const QUALITY_GAUNTLET_TRANSITION_SCHEMA_ID: "atm.qualityGauntletTransition.v1";
/** How the caller ends a run. Omitting it leaves the run resumable. */
export type QualityGauntletStop = 'stop' | 'indeterminate';
export interface QualityGauntletObligationInput {
    readonly obligationId: string;
    readonly semanticFamily?: string | null;
    readonly owningSeam?: string | null;
    /** Declared unreachable or out of scope for this checkpoint. */
    readonly excluded?: boolean;
}
export interface QualityGauntletValidatorResultInput {
    readonly command: string;
    readonly caseId?: string | null;
    readonly outcome: 'pass' | 'fail' | 'skipped' | 'unknown';
    readonly obligationIds: readonly string[];
    readonly detail?: string | null;
}
export interface QualityGauntletRequest {
    readonly runId: string;
    readonly checkpoint: string;
    readonly requestedAt: string;
    readonly obligations: readonly QualityGauntletObligationInput[];
    readonly validatorResults: readonly QualityGauntletValidatorResultInput[];
    readonly stop?: QualityGauntletStop | null;
    readonly stopReason?: string | null;
}
export interface QualityGauntletTransition {
    readonly schemaId: typeof QUALITY_GAUNTLET_TRANSITION_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly gauntletId: typeof QUALITY_GAUNTLET_ID;
    readonly runId: string;
    readonly checkpoint: string;
    readonly fromState: ClosureAssuranceState;
    readonly toState: ClosureAssuranceState;
    readonly verdict: ClosureAssuranceVerdict;
    readonly terminal: boolean;
    readonly emittedEvents: readonly QualityGauntletEvent[];
    readonly view: ClosureAssuranceView;
    readonly transitionDigest: string;
}
export interface QualityGauntletInspection {
    readonly gauntletId: typeof QUALITY_GAUNTLET_ID;
    readonly runId: string;
    readonly checkpoint: string;
    readonly view: ClosureAssuranceView;
    readonly events: readonly QualityGauntletEvent[];
}
export interface QualityGauntletReplayReport {
    readonly gauntletId: typeof QUALITY_GAUNTLET_ID;
    readonly runId: string;
    readonly checkpoint: string;
    readonly view: ClosureAssuranceView;
    readonly replayedEventCount: number;
    readonly duplicateEventIds: readonly string[];
    /** Two independent reductions of the same stream agreed. */
    readonly deterministic: boolean;
}
export declare class QualityGauntlet {
    #private;
    /**
     * Move one run forward. A first call starts it; later calls resume it from the
     * recorded events rather than from anything the caller kept, which is what
     * makes a checkpoint safe to retry after an interruption.
     */
    advance(request: QualityGauntletRequest): QualityGauntletTransition;
    /** The public view and event log of a run, or null when it was never started. */
    inspect(runId: string): QualityGauntletInspection | null;
    /**
     * Rebuild a view from events alone. This deliberately ignores facade state:
     * an auditor holding only the recorded stream must reach the same verdict as
     * the process that produced it.
     */
    replay(input: {
        readonly runId: string;
        readonly checkpoint: string;
        readonly events: readonly QualityGauntletEvent[];
    }): QualityGauntletReplayReport;
}
