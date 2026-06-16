import type { SharedSurfacesRecord, WriteIntent } from './types.ts';
/**
 * Structural mirror of the plugin-sdk `AtomCandidate` schema (TASK-ASP-0001).
 *
 * `@ai-atomic-framework/plugin-sdk` depends on core, so core cannot import the
 * SDK type without creating a package cycle. The bridge therefore accepts any
 * value assignable to this shape; plugin-sdk `AtomCandidate` satisfies it
 * verbatim (the candidate-bridge tests assert that assignability).
 */
export interface BridgeAtomCandidate {
    readonly candidateId: string;
    readonly kind: string;
    readonly symbol: string;
    readonly filePath: string;
    readonly lineStart: number | null;
    readonly lineEnd: number | null;
    readonly confidence: 'high' | 'medium' | 'low';
    readonly detectionMethod: string;
    readonly suggestedAtomId?: string;
    readonly suggestedSourcePaths?: readonly string[];
    readonly notes?: readonly string[];
}
export interface CandidateBridgeContext {
    readonly taskId: string;
    readonly actorId: string;
    readonly baseCommit: string;
    readonly sharedSurfaces?: Partial<SharedSurfacesRecord>;
    readonly requestedLane?: WriteIntent['requestedLane'];
}
/**
 * Convert discovered atom candidates into a well-formed `WriteIntent` for
 * `calculateBrokerDecision()` (TASK-ASP-0004). Pure and deterministic: no
 * LLM calls, no language semantics, and the candidate input is never mutated.
 */
export declare function candidatesToWriteIntent(candidates: readonly BridgeAtomCandidate[], ctx: CandidateBridgeContext): WriteIntent;
/**
 * Deterministic atom CID: SHA-256 over the canonical candidate contract
 * `(kind || symbol || sourcePaths || detectionMethod)`, where `sourcePaths`
 * is the deduplicated, sorted union of `filePath` and `suggestedSourcePaths`.
 * The same candidate always produces the same CID across runs and processes.
 */
export declare function computeCandidateAtomCid(candidate: BridgeAtomCandidate): string;
