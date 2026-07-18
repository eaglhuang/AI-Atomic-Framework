import { type NextClaimIntent } from './claim-readiness.ts';
import { type TaskIntent } from './intent-normalizers.ts';
import type { ImportedTaskQueue } from './route-predicates.ts';
import type { inspectIntegrationBootstrap } from '../integration.ts';
import type { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
export declare function tryBuildQuickfixClaimResult(input: {
    readonly cwd: string;
    readonly actor: string | undefined;
    readonly promptText: string;
    readonly quickfixScope: readonly string[];
    readonly taskIntent: TaskIntent | null;
    readonly importedTaskQueue: ImportedTaskQueue;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}): import("../shared.ts").CommandResult | null;
export declare function buildNoClaimableTaskResult(input: {
    readonly cwd: string;
    readonly claimIntent: NextClaimIntent;
    readonly importedTaskQueue: ImportedTaskQueue;
    readonly taskIntent: TaskIntent | null;
}): import("../shared.ts").CommandResult;
