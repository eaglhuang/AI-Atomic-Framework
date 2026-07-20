import type { ImportedTaskSummary } from './route-predicates.ts';
export declare function prepareImportedTaskForClaim(input: {
    readonly cwd: string;
    readonly task: ImportedTaskSummary;
    readonly actorId: string;
}): Promise<{
    taskId: string;
    originalStatus: string;
    steps: {
        action: "reserve" | "promote";
        evidence: {
            action: "reserve" | "promote";
            taskId: string;
            actorId: string;
            status: "reserved" | "ready";
            transitionPath: string;
            importEvidencePath: string | null;
        };
    }[];
}>;
export declare function registerPreClaimBrokerTransaction(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly targetFiles: readonly string[];
}): Promise<Record<string, unknown>>;
export declare function buildPreClaimWriteIntent(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly baseCommit: string;
    readonly targetFiles: readonly string[];
}): {
    readonly schemaId: "atm.writeIntent.v1";
    readonly specVersion: "0.1.0";
    readonly migration: {
        readonly strategy: "none";
        readonly fromVersion: null;
        readonly notes: "next pre-claim Broker transaction";
    };
    readonly taskId: string;
    readonly actorId: string;
    readonly baseCommit: string;
    readonly targetFiles: string[];
    readonly atomRefs: readonly [];
    readonly sharedSurfaces: import("@ai-atomic-framework/core").SharedSurfacesRecord;
    readonly requestedLane: "auto";
};
