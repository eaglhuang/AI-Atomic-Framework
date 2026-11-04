/**
 * Validator catalog selection bridge and resumable probe scheduler.
 *
 * A task card already says what it changed — required case ids, declared
 * validators, public seams, causal impact edges. The catalog already says what
 * each test proves. What was missing is the bridge: turning "this is my impact
 * cone" into "these probes, and no others", with a stated reason for every case
 * that was left out.
 *
 * Two properties make that bridge trustworthy:
 *
 *   - Omission is explicit. A validator that is not run must carry a reason
 *     code, so a thin selection is auditable rather than merely fast.
 *   - A required case with no catalog mapping fails closed. Silently selecting
 *     nothing for it would report a clean run over an unproven boundary.
 *
 * The scheduler exists because probes are executed by something slower and less
 * reliable than this process. A run that is interrupted must resume without
 * repeating completed work or dropping pending work, and data that could not be
 * gathered must surface as an evidence request instead of a pass.
 *
 * Pure and I/O-free: callers supply the catalog snapshot and observations.
 */
export declare const VALIDATOR_CATALOG_SELECTION_SCHEMA_ID: "atm.validatorCatalogSelection.v1";
export declare const RESUMABLE_PROBE_SCHEDULE_SCHEMA_ID: "atm.resumableProbeSchedule.v1";
export declare const ATM_VALIDATOR_CATALOG_MAPPING_MISSING: "ATM_VALIDATOR_CATALOG_MAPPING_MISSING";
export declare const ATM_PROBE_DATA_UNAVAILABLE: "ATM_PROBE_DATA_UNAVAILABLE";
export type ValidatorSelectionResponsibility = 'task-required' | 'phase-suite' | 'advisory';
/**
 * Why a case is in the selection. The reasons are the task-card inputs, so a
 * reader can trace any selected probe back to the declaration that pulled it in.
 */
export type SelectionInclusionReason = 'task-required-case' | 'declared-validator-ref' | 'seam-overlap' | 'impact-edge-overlap';
/** Why a case was left out. Today the cone is the only reason to skip. */
export type SelectionOmissionReason = 'outside-impact-cone';
export interface CatalogCaseEntry {
    readonly caseId: string;
    readonly groupId: string;
    readonly command: string | null;
    readonly responsibility: ValidatorSelectionResponsibility;
    readonly supportedSeams: readonly string[];
    readonly coversImpactEdges: readonly string[];
    readonly coversAcceptance: readonly string[];
}
export interface ValidatorSelectionRequest {
    readonly taskId: string;
    readonly requiredTestCaseIds: readonly string[];
    readonly validatorRefs: readonly {
        readonly command: string;
        readonly caseId?: string | null;
    }[];
    readonly changedPublicSeams: readonly string[];
    readonly causalImpactEdges: readonly string[];
}
export interface SelectedValidatorProbe {
    readonly caseId: string;
    readonly groupId: string;
    readonly command: string | null;
    readonly responsibility: ValidatorSelectionResponsibility;
    readonly reasons: readonly SelectionInclusionReason[];
}
export interface OmittedValidatorEntry {
    readonly caseId: string;
    readonly groupId: string;
    readonly reasonCode: SelectionOmissionReason;
    readonly reason: string;
}
export interface ValidatorCatalogSelectionFailClosed {
    readonly code: typeof ATM_VALIDATOR_CATALOG_MAPPING_MISSING;
    readonly summary: string;
    readonly requiredCommand: string;
    readonly repairHint: string;
}
export interface ValidatorCatalogSelection {
    readonly schemaId: typeof VALIDATOR_CATALOG_SELECTION_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly ok: boolean;
    readonly selected: readonly SelectedValidatorProbe[];
    readonly omitted: readonly OmittedValidatorEntry[];
    readonly unmappedRequiredCaseIds: readonly string[];
    readonly failClosed: ValidatorCatalogSelectionFailClosed | null;
    readonly selectionDigest: string;
}
export declare function selectValidatorCatalogEntries(input: {
    readonly catalog: readonly CatalogCaseEntry[];
    readonly request: ValidatorSelectionRequest;
}): ValidatorCatalogSelection;
export type ProbeStatus = 'pending' | 'completed' | 'unavailable' | 'failed';
export type ProbeVerdict = 'complete' | 'incomplete' | 'blocked';
export interface ProbeRecord {
    readonly probeId: string;
    readonly caseId: string;
    readonly command: string | null;
    readonly status: ProbeStatus;
    readonly attempts: number;
    readonly detail: string | null;
}
export interface ProbeCursor {
    /** The probe a resumed run should execute next, or null when nothing is owed. */
    readonly nextProbeId: string | null;
    readonly completed: number;
    readonly pending: number;
    readonly unavailable: number;
    readonly failed: number;
}
export interface ProbeEvidenceRequest {
    readonly code: typeof ATM_PROBE_DATA_UNAVAILABLE;
    readonly probeId: string;
    readonly caseId: string;
    readonly summary: string;
    readonly requiredCommand: string;
}
export interface ResumableProbeSchedule {
    readonly schemaId: typeof RESUMABLE_PROBE_SCHEDULE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly scheduleId: string;
    readonly probes: readonly ProbeRecord[];
    readonly cursor: ProbeCursor;
    readonly verdict: ProbeVerdict;
    readonly terminal: boolean;
    readonly evidenceRequests: readonly ProbeEvidenceRequest[];
    readonly duplicateObservationIds: readonly string[];
    readonly unknownObservationIds: readonly string[];
    readonly scheduleDigest: string;
}
export interface ProbeObservation {
    readonly probeId: string;
    readonly status: Exclude<ProbeStatus, 'pending'>;
    readonly detail?: string | null;
}
export declare function planResumableProbeSchedule(input: {
    readonly selection: ValidatorCatalogSelection;
    readonly scheduleId: string;
}): ResumableProbeSchedule;
/**
 * Fold observations into a schedule. Resume is a pure function of the schedule
 * plus what was observed, so an interrupted run reaches the same state whether
 * it is replayed in one pass or resumed a step at a time.
 */
export declare function resumeProbeSchedule(input: {
    readonly schedule: ResumableProbeSchedule;
    readonly observations: readonly ProbeObservation[];
}): ResumableProbeSchedule;
