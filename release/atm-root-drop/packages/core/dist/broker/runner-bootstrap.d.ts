import { type RunnerRefStore } from './runner-ref-store.ts';
import type { RunnerVersionStreamRecord } from './runner-version-state.ts';
export type RecoveryDecision = 'no-recovery-needed' | 'reseed-from-version' | 'rollback-rc-to-in-dev' | 'quarantine';
export interface RecoveryFinding {
    readonly code: 'in-dev-head-orphaned' | 'rc-frozen-with-no-publish' | 'no-version-ref-found' | 'lease-held-but-state-published';
    readonly detail: string;
}
export interface RunnerBootstrapInput {
    readonly refStore: RunnerRefStore;
    readonly stream: RunnerVersionStreamRecord;
    /** Source commits known to exist in the target repo (for orphan checks). */
    readonly reachableSourceCommits: ReadonlySet<string>;
}
export interface RunnerBootstrapPlan {
    readonly schemaId: 'atm.runnerBootstrapPlan.v1';
    readonly decision: RecoveryDecision;
    readonly findings: readonly RecoveryFinding[];
    readonly suggestedNextAction: string;
}
export declare function analyzeBootstrap(input: RunnerBootstrapInput): RunnerBootstrapPlan;
