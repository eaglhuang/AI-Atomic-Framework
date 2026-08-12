import { createFrameworkModeStatus } from '../framework-development.ts';
import { inspectIntegrationBootstrap } from '../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
import type { ImportedTaskQueue } from './route-predicates.ts';
export declare function buildCrossRepoFrameworkNextResult(input: {
    readonly cwd: string;
    readonly frameworkStatus: ReturnType<typeof createFrameworkModeStatus>;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
    readonly importedTaskQueue: ImportedTaskQueue | null;
}): import("../shared.ts").CommandResult;
