/**
 * Mutation adapter, replayable lineage, and equivalence governance.
 *
 * Plan 4.0 mutation evidence must come from a pinned adapter that only runs
 * inside an ATM-GOV-0285-selected probe window. Observations become replayable
 * lineage records (mutant id, killed/survived, score bounds, seed/digest) and
 * survivors are classified as equivalent or non-equivalent.
 *
 * Raw adapter "pass" never authorizes close. Unsupported or inconclusive
 * adapters fail closed. Downstream family matching (ATM-GOV-0293) may consume
 * lineage as supporting evidence only — never as the sole matching authority.
 *
 * Pure and I/O-free: callers supply the probe window and observations.
 */
export declare const MUTATION_ADAPTER_SCHEMA_ID: "atm.mutationAdapter.v1";
export declare const MUTATION_LINEAGE_SCHEMA_ID: "atm.mutationLineage.v1";
export declare const MUTATION_EQUIVALENCE_GOVERNANCE_SCHEMA_ID: "atm.mutationEquivalenceGovernance.v1";
export declare const MUTATION_FAMILY_MATCH_EVIDENCE_SCHEMA_ID: "atm.mutationLineageFamilyMatchEvidence.v1";
export declare const PINNED_IN_PROCESS_MUTATION_ADAPTER_ID: "atm.mutation.adapter.inProcessFixture.v1";
export declare const ATM_MUTATION_ADAPTER_UNSUPPORTED: "ATM_MUTATION_ADAPTER_UNSUPPORTED";
export declare const ATM_MUTATION_ADAPTER_INCONCLUSIVE: "ATM_MUTATION_ADAPTER_INCONCLUSIVE";
export declare const ATM_MUTATION_PROBE_WINDOW_VIOLATION: "ATM_MUTATION_PROBE_WINDOW_VIOLATION";
export declare const ATM_MUTATION_LINEAGE_REPLAY_MISMATCH: "ATM_MUTATION_LINEAGE_REPLAY_MISMATCH";
export type MutationAdapterCapability = 'supported' | 'unsupported' | 'inconclusive';
export type MutantOutcome = 'killed' | 'survived';
export type EquivalenceClass = 'equivalent' | 'non-equivalent' | 'not-applicable';
/** Successful lineage is evidence-ready only; it never becomes a close pass. */
export type MutationAdapterVerdict = 'evidence-ready' | 'fail-closed';
export interface PinnedMutationAdapter {
    readonly schemaId: typeof MUTATION_ADAPTER_SCHEMA_ID;
    readonly adapterId: typeof PINNED_IN_PROCESS_MUTATION_ADAPTER_ID | string;
    /** Pin identity (version digest or fixture pin). Required for determinism. */
    readonly pin: string;
    readonly capability: MutationAdapterCapability;
    readonly detail: string | null;
}
/** ATM-GOV-0285-selected probe window the adapter is allowed to execute inside. */
export interface MutationProbeWindow {
    readonly taskId: string;
    readonly selectionDigest: string;
    readonly allowedProbeIds: readonly string[];
}
export interface MutationObservationInput {
    readonly mutantId: string;
    readonly probeId: string;
    readonly seed: string;
    readonly outcome: MutantOutcome;
    /**
     * When outcome is survived, compare behavioral digests to classify
     * equivalence. Missing digests on a survivor are treated as non-equivalent
     * (fail closed on optimistic scoring).
     */
    readonly behavioralDigest?: string | null;
    readonly originalBehavioralDigest?: string | null;
}
export interface MutationLineageRecord {
    readonly mutantId: string;
    readonly probeId: string;
    readonly outcome: MutantOutcome;
    readonly equivalence: EquivalenceClass;
    readonly lowerBound: number;
    readonly upperBound: number;
    readonly seed: string;
    readonly digest: string;
}
export interface MutationScoreBounds {
    readonly killed: number;
    readonly survived: number;
    readonly equivalent: number;
    readonly nonEquivalent: number;
    readonly total: number;
    readonly lowerBound: number;
    readonly upperBound: number;
}
export interface MutationAdapterFailClosed {
    readonly code: typeof ATM_MUTATION_ADAPTER_UNSUPPORTED | typeof ATM_MUTATION_ADAPTER_INCONCLUSIVE | typeof ATM_MUTATION_PROBE_WINDOW_VIOLATION | typeof ATM_MUTATION_LINEAGE_REPLAY_MISMATCH;
    readonly summary: string;
    readonly repairHint: string;
}
export interface MutationLineageReport {
    readonly schemaId: typeof MUTATION_LINEAGE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly adapterSchemaId: typeof MUTATION_ADAPTER_SCHEMA_ID;
    readonly equivalenceSchemaId: typeof MUTATION_EQUIVALENCE_GOVERNANCE_SCHEMA_ID;
    readonly taskId: string;
    readonly selectionDigest: string;
    readonly adapterId: string;
    readonly adapterPin: string;
    readonly ok: boolean;
    /** Adapter pass never authorizes close; only fail or fail-closed. */
    readonly verdict: MutationAdapterVerdict;
    readonly closeAuthorization: 'denied';
    readonly failClosed: MutationAdapterFailClosed | null;
    readonly records: readonly MutationLineageRecord[];
    readonly bounds: MutationScoreBounds;
    readonly lineageDigest: string;
}
/**
 * Projection for ATM-GOV-0293. Explicitly non-sole: family matching may use
 * this to strengthen or weaken confidence, but must keep its own authority.
 */
export interface MutationFamilyMatchEvidence {
    readonly schemaId: typeof MUTATION_FAMILY_MATCH_EVIDENCE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly lineageDigest: string;
    readonly soleMatchingAuthority: false;
    readonly authorityRole: 'supporting-evidence-only';
    readonly mayStrengthenOrWeakenConfidence: true;
    readonly survivors: readonly {
        readonly mutantId: string;
        readonly equivalence: Exclude<EquivalenceClass, 'not-applicable'>;
        readonly digest: string;
    }[];
    readonly killedMutantIds: readonly string[];
}
export interface MutationLineageReplayReport {
    readonly ok: boolean;
    readonly deterministic: boolean;
    readonly expectedLineageDigest: string;
    readonly recomputedLineageDigest: string;
    readonly failClosed: MutationAdapterFailClosed | null;
}
export declare function createPinnedInProcessMutationAdapter(input: {
    readonly pin: string;
    readonly capability?: MutationAdapterCapability;
    readonly detail?: string | null;
}): PinnedMutationAdapter;
export declare function classifySurvivorEquivalence(input: {
    readonly outcome: MutantOutcome;
    readonly behavioralDigest?: string | null;
    readonly originalBehavioralDigest?: string | null;
}): EquivalenceClass;
export declare function runMutationAdapter(input: {
    readonly adapter: PinnedMutationAdapter;
    readonly probeWindow: MutationProbeWindow;
    readonly observations: readonly MutationObservationInput[];
}): MutationLineageReport;
export declare function replayMutationLineage(input: {
    readonly report: MutationLineageReport;
}): MutationLineageReplayReport;
export declare function toFamilyMatchEvidence(report: MutationLineageReport): MutationFamilyMatchEvidence;
