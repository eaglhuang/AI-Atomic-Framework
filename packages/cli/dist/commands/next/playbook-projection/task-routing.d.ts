import { inspectIntegrationBootstrap } from '../../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../../runtime-adapter-readiness.ts';
import { type ImportedTaskQueue, type ImportedTaskSummary } from '../route-predicates.ts';
export declare function buildAgentPackHint(status: string, command?: string | null, reason?: string | null): {
    slashCommandId: string;
    route: string;
    command: string;
    reason: string;
};
export declare function buildMirrorSyncNextAction(input: {
    readonly task: ImportedTaskSummary;
    readonly classification: TaskDeliveryClassification;
}): NextActionLike;
export declare function buildActiveTaskDivergenceResult(input: {
    readonly cwd: string;
    readonly taskIntent: TaskIntent | null;
    readonly importedTaskQueue: ImportedTaskQueue;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}): import("../../shared.ts").CommandResult | null;
