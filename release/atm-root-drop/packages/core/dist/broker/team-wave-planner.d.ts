export type WaveBlockReason = 'depends-on-open-wave-member' | 'scope-overlap-unknown-range' | 'same-atom-write-write' | 'closure-authority-mismatch' | 'target-repo-mismatch' | 'generated-artifact-contention' | 'missing-validator';
export interface WaveCandidateCard {
    readonly taskId: string;
    /** Dependency task ids; a card is only schedulable when all deps are closed. */
    readonly dependencies: readonly string[];
    readonly scopePaths: readonly string[];
    readonly deliverables: readonly string[];
    readonly validators: readonly string[];
    readonly targetRepo: string | null;
    readonly closureAuthority: string | null;
    /** Owner atom/map id, used for write/write contention on generated artifacts. */
    readonly ownerAtomOrMap?: string | null;
}
export interface WavePlanInput {
    readonly cards: readonly WaveCandidateCard[];
    /** Task ids already closed (dependency edges may point at these). */
    readonly closedTaskIds?: readonly string[];
    /**
     * Files known to be append-/shard-safe under concurrent writes. Overlap that
     * is confined to these files does not block a wave (spec §5 rule 2/7: still
     * sequenced to one writer per wave, but does not fail closed).
     */
    readonly appendSafePaths?: readonly string[];
}
export interface WaveMember {
    readonly taskId: string;
}
export interface PlannedWave {
    readonly waveIndex: number;
    readonly members: readonly WaveMember[];
}
export interface DeferredCard {
    readonly taskId: string;
    readonly reasons: readonly WaveBlockReason[];
    /** The wave index the card was deferred from (it rolls into a later wave). */
    readonly deferredFromWave: number;
}
export interface WavePlan {
    readonly schemaId: 'atm.teamWavePlan.v1';
    readonly waves: readonly PlannedWave[];
    /** Cards that could not be scheduled at all (e.g. unresolved dependencies). */
    readonly unschedulable: readonly DeferredCard[];
    readonly totalCards: number;
}
/**
 * Decide whether two cards may share a wave. Returns the set of block reasons;
 * an empty set means the pair is co-schedulable. Fails closed: any overlap that
 * is not provably append-safe is reported.
 */
export declare function pairBlockReasons(left: WaveCandidateCard, right: WaveCandidateCard, appendSafe: ReadonlySet<string>): readonly WaveBlockReason[];
/**
 * Plan ordered waves from a set of candidate cards. Greedy: repeatedly take the
 * largest prefix of dependency-ready cards that are mutually co-schedulable,
 * deferring conflicting cards to the next round. Deterministic by task id order.
 */
export declare function planWaves(input: WavePlanInput): WavePlan;
