import { inspectIntegrationBootstrap } from '../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
import { type TaskIntent } from './intent-normalizers.ts';
import { type ImportedTaskQueue } from './route-predicates.ts';
import { type NextClaimIntent } from './claim-readiness.ts';
export { diagnoseClaimReadinessForTasks, extractClaimIntentFlag, type ClaimReadinessDiagnostic, type ClaimReadinessReport, type ClaimReadinessTaskSummary, type NextClaimIntent } from './claim-readiness.ts';
export declare function claimNextImportedTask(input: {
    readonly cwd: string;
    readonly actor: string | undefined;
    readonly claimIntent?: NextClaimIntent | null;
    readonly autoIntent?: boolean;
    readonly forceClaim?: boolean;
    readonly claimFiles?: readonly string[];
    readonly taskIntent: TaskIntent | null;
    readonly importedTaskQueue: ImportedTaskQueue;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}): Promise<import("../shared.ts").CommandResult>;
