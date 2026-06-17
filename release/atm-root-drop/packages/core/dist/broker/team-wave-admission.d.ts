import { type WaveCandidateCard } from './team-wave-planner.ts';
import type { WriteIntent } from './types.ts';
export type WaveAdmissionCategory = 'dependency' | 'scope-overlap' | 'cid-conflict' | 'generated-artifact' | 'closure-authority' | 'target-repo' | 'missing-worker-report' | 'missing-validator';
export interface WaveAdmissionMemberInput {
    readonly card: WaveCandidateCard;
    /** The card's intended write set, if a patch envelope / intent was captured. */
    readonly writeIntent?: WriteIntent | null;
    /** Whether a worker report exists for this in-flight card. */
    readonly hasWorkerReport?: boolean;
}
export interface WaveAdmissionInput {
    readonly members: readonly WaveAdmissionMemberInput[];
    readonly closedTaskIds?: readonly string[];
    readonly appendSafePaths?: readonly string[];
    /** When true, an in-flight member without a worker report is rejected. */
    readonly requireWorkerReports?: boolean;
}
export interface WaveAdmissionRejection {
    readonly taskId: string;
    readonly categories: readonly WaveAdmissionCategory[];
    readonly detail: string;
}
export interface WaveAdmissionDecision {
    readonly schemaId: 'atm.teamWaveAdmission.v1';
    readonly admitted: readonly string[];
    readonly rejected: readonly WaveAdmissionRejection[];
    /** True only if at least one member was admitted and none failed closed unexpectedly. */
    readonly ok: boolean;
}
/**
 * Admit a proposed wave. A member is admitted only when:
 *  - all its dependencies are closed (outside the wave),
 *  - it declares at least one validator,
 *  - it has no metadata-level conflict with any already-admitted member,
 *  - its write intent does not produce a freeze/takeover verdict against the
 *    admitted members' intents (CID logical conflict),
 *  - a worker report exists when required.
 * Evaluation is deterministic by task id; the first member of a conflicting pair
 * is admitted and the later one is rejected (fail closed).
 */
export declare function admitWave(input: WaveAdmissionInput): WaveAdmissionDecision;
