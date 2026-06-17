import type { MigrationRecord } from './types.ts';
export type RunnerVersionState = 'in-dev' | 'rc-stabilizing' | 'rc-frozen' | 'published' | 'retired';
export type RunnerVersionTransition = 'cut-rc' | 'freeze-rc' | 'publish' | 'rollback-rc' | 'retire';
export interface RunnerVersionStreamRecord {
    readonly schemaId: 'atm.runnerVersionStream.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly streamId: string;
    readonly state: RunnerVersionState;
    readonly lease: {
        readonly heldBy: string | null;
        readonly heldUntil: string | null;
    };
    readonly history: readonly {
        readonly at: string;
        readonly transition: RunnerVersionTransition;
        readonly fromState: RunnerVersionState;
        readonly toState: RunnerVersionState;
        readonly actorId: string;
    }[];
}
export declare function createRunnerVersionStream(streamId: string): RunnerVersionStreamRecord;
export interface RunnerVersionTransitionResult {
    readonly ok: boolean;
    readonly reason: string;
    readonly record: RunnerVersionStreamRecord;
}
export declare function transitionRunnerVersion(record: RunnerVersionStreamRecord, transition: RunnerVersionTransition, actorId: string, at?: string): RunnerVersionTransitionResult;
export declare function acquireRunnerVersionLease(record: RunnerVersionStreamRecord, actorId: string, ttlSeconds: number, now?: string): RunnerVersionTransitionResult;
