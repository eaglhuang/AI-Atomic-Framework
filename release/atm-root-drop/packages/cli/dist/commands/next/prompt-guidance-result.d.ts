import { inspectIntegrationBootstrap } from '../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
import type { TaskIntent } from './intent-normalizers.ts';
import type { ImportedTaskQueue } from './route-predicates.ts';
export declare function buildPromptGuidanceNextResult(input: {
    readonly cwd: string;
    readonly actor?: string;
    readonly taskIntent: TaskIntent | null;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}): import("../shared.ts").CommandResult | null;
export declare function buildPromptRequiredNextResult(input: {
    readonly cwd: string;
    readonly claimRequested: boolean;
    readonly importedTaskQueue: ImportedTaskQueue;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}): import("../shared.ts").CommandResult;
