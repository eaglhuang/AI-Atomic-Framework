import { type TaskIntent } from './intent-normalizers.ts';
import { type ImportedTaskQueue } from './route-predicates.ts';
import type { inspectIntegrationBootstrap } from '../integration.ts';
import type { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
export declare function buildPromptScopedNextResult(input: {
    readonly cwd: string;
    readonly actor?: string;
    readonly taskIntent: TaskIntent | null;
    readonly importedTaskQueue: ImportedTaskQueue;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}): import("../shared.ts").CommandResult | null;
