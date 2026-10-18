import type { SharedSurfacesRecord, WriteIntent } from './types.js';
import { type GovernanceResourceProjectionOptions } from './global-resource-projection.js';
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
    /** Language of the source file; inferred from the file extension when absent. */
    readonly languageId?: string;
    /**
     * Position among same-kind, same-symbol atoms in one file (source order,
     * 0-based). Set only when such duplicates exist; see derived-atoms.ts.
     */
    readonly ordinal?: number;
}
export interface CandidateBridgeContext {
    readonly taskId: string;
    readonly actorId: string;
    readonly baseCommit: string;
    readonly sharedSurfaces?: Partial<SharedSurfacesRecord>;
    readonly governanceResources?: GovernanceResourceProjectionOptions;
    readonly requestedLane?: WriteIntent['requestedLane'];
}
/**
 * Convert discovered atom candidates into a well-formed `WriteIntent` for
 * `calculateBrokerDecision()` (TASK-ASP-0004). Pure and deterministic: no
 * LLM calls, no language semantics, and the candidate input is never mutated.
 */
export declare function candidatesToWriteIntent(candidates: readonly BridgeAtomCandidate[], ctx: CandidateBridgeContext): WriteIntent;
export declare const ATOM_CID_FORMULA_VERSION: "cid.v2";
/**
 * Deterministic atom CID (cid.v2, TASK-ASP-0006): SHA-256 over
 * `cid.v2 || languageId || sourcePaths || kind || symbol || ordinal`, where
 * `sourcePaths` is the deduplicated, sorted union of `filePath` and
 * `suggestedSourcePaths`. Line numbers and `detectionMethod` are not part of
 * the identity: inserting lines above an atom or upgrading the detector keeps
 * its CID. Content changes are tracked separately (`computeAtomContentVersion`).
 */
export declare function computeCandidateAtomCid(candidate: BridgeAtomCandidate): string;
export declare function inferLanguageId(filePath: string): string;
