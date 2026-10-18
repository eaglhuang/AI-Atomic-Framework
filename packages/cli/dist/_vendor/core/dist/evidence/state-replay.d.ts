export declare const STATE_REPLAY_SCHEMA_ID: "atm.stateReplay.v1";
export declare const STATE_REPLAY_SPEC_VERSION: "0.2.0";
export declare const replayDogfoodSignals: readonly ["cross-lane-shared-index", "close-deferral", "active-batch-routing"];
export type ReplayDogfoodSignal = typeof replayDogfoodSignals[number];
export type ReplayVerdict = 'repaired' | 'regressed' | 'stale' | 'forged' | 'missing' | 'unsupported';
export interface ReplayBinding {
    readonly sourceCommit: string;
    readonly runnerDigest: string;
    readonly treeDigest: string;
    readonly provenanceDigest: string;
    readonly fixtureDigest: string;
    readonly repairDigest?: string;
}
export interface ReplayDogfoodWitness {
    readonly signal: ReplayDogfoodSignal;
    readonly laneIds: readonly string[];
    readonly eventDigest: string;
}
export interface ReplayObservation {
    readonly incidentId: string;
    readonly family: string;
    readonly historical: boolean;
    readonly supported: boolean;
    readonly fixtureOnly?: boolean;
    readonly expected: ReplayBinding;
    readonly observed: ReplayBinding;
    readonly dogfoodWitness?: ReplayDogfoodWitness;
    readonly sealDigest: string;
}
export interface ReplayVerdictEntry {
    readonly incidentId: string;
    readonly family: string;
    readonly verdict: ReplayVerdict;
    readonly diagnostics: readonly string[];
}
export interface StateReplayResult {
    readonly schemaId: typeof STATE_REPLAY_SCHEMA_ID;
    readonly specVersion: typeof STATE_REPLAY_SPEC_VERSION;
    readonly authorityDigest: string;
    readonly status: 'proven' | 'blocked';
    readonly verdicts: readonly ReplayVerdictEntry[];
    readonly requiredFamilies: readonly string[];
    readonly requiredDogfoodSignals: readonly ReplayDogfoodSignal[];
    readonly observedDogfoodSignals: readonly ReplayDogfoodSignal[];
    readonly nonClaims: readonly string[];
    readonly historicalIncidentIds: readonly string[];
    readonly diagnostics: readonly string[];
    readonly resultDigest: string;
}
export declare function sealReplayObservation(observation: Omit<ReplayObservation, 'sealDigest'>): string;
export declare function replayState(input: {
    readonly authorityDigest: string;
    readonly observations?: readonly ReplayObservation[];
    readonly requiredFamilies?: readonly string[];
    readonly requiredDogfoodSignals?: readonly ReplayDogfoodSignal[];
}): StateReplayResult;
export declare const replayStateReplay: typeof replayState;
export declare function validateStateReplay(result: StateReplayResult): {
    readonly ok: boolean;
    readonly diagnostics: readonly string[];
};
