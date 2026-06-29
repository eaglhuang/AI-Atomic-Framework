import { type AtmCorePatchEnvelope } from './patch-envelope-atm-core.ts';
import { type RunnerRefStore } from './runner-ref-store.ts';
export type RunnerSubmitVerdict = 'accept' | 'reject-malformed' | 'reject-conflict' | 'reject-stale-base' | 'freeze-await-rebase';
export interface RunnerSubmitDecision {
    readonly schemaId: 'atm.runnerSubmitDecision.v1';
    readonly verdict: RunnerSubmitVerdict;
    readonly reason: string;
    readonly envelopeId: string;
    readonly resolvedTargetRefHead: string | null;
    readonly suggestedNextAction: string;
}
export interface RunnerSubmitInput {
    readonly envelope: AtmCorePatchEnvelope;
    readonly refStore: RunnerRefStore;
    /** Optional set of currently-frozen ref names; submits to a frozen ref freeze-await. */
    readonly frozenRefs?: readonly string[];
}
export declare function submitRunnerPatch(input: RunnerSubmitInput): RunnerSubmitDecision;
