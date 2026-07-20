import type { ImportedTaskQueue } from './route-predicates.ts';
export type NextWorkChannel = 'fast' | 'normal' | 'batch' | 'quickfix' | 'task-route-ready';
export type ChannelRiskLevel = 'low' | 'medium' | 'high';
export interface ChannelStrategyDecision {
    readonly schemaId: 'atm.nextChannelStrategy.v1';
    readonly channel: NextWorkChannel;
    readonly recommendedChannel: string;
    readonly riskLevel: ChannelRiskLevel;
    readonly reason: string;
    readonly stableCode: string;
}
export interface RuntimeNextAction {
    readonly status: string;
    readonly command: string;
    readonly reason: string;
    readonly allowedCommands: readonly string[];
    readonly blockedCommands: readonly string[];
    readonly afterNextAction?: string;
    readonly selectedTask?: unknown;
}
export declare function allowedGuidanceBootstrapCommands(): readonly string[];
export declare function blockedMutationCommands(): readonly string[];
export declare function decideRuntimeNextAction(runtime: Record<string, unknown>, failedCheckName: string | null | undefined, importedTaskQueue: ImportedTaskQueue): RuntimeNextAction;
export declare function selectQuickfixChannel(): ChannelStrategyDecision;
export declare function selectBatchChannel(reason: string): ChannelStrategyDecision;
export declare function selectNormalTaskRouteChannel(reason: string): ChannelStrategyDecision;
export declare function selectPostClaimChannel(batchActive: boolean): ChannelStrategyDecision;
export declare function selectUnknownRuntimeChannel(): ChannelStrategyDecision;
/**
 * Assert the strategy helpers never mutate caller-owned input objects.
 */
export declare function channelStrategyPreservesInput<T extends object>(input: T, selector: (value: T) => ChannelStrategyDecision): boolean;
