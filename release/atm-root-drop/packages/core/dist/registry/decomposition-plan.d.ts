import type { RegistryMapEdgeRecord, RegistryMapMemberRecord, RegistryMapQualityTargetValue } from '../index';
export declare const defaultDecompositionPlanSchemaPath: string;
interface DecompositionPlanOptions {
    readonly cwd?: string;
    readonly schemaPath?: string;
}
interface DecompositionPlanIssue {
    readonly path: string;
    readonly keyword: string;
    readonly message: string;
    readonly params: Record<string, unknown>;
}
export declare function readDecompositionPlan(planPath: string, options?: DecompositionPlanOptions): {
    plan: any;
    absolutePlanPath: string;
    relativePlanPath: string;
    validation: {
        ok: boolean;
        schemaPath: string;
        issues: DecompositionPlanIssue[];
    };
};
export declare function validateDecompositionPlanDocument(document: unknown, options?: DecompositionPlanOptions): {
    ok: boolean;
    schemaPath: string;
    issues: DecompositionPlanIssue[];
};
export declare function createAtomicMapRequestFromDecompositionPlan(plan: unknown): {
    mapId: string;
    request: {
        mapVersion: string;
        specVersion: string;
        members: RegistryMapMemberRecord[];
        edges: RegistryMapEdgeRecord[];
        entrypoints: any[];
        qualityTargets: Readonly<Record<string, RegistryMapQualityTargetValue>>;
        replacement: {
            legacyUris: any[];
            mode: string;
            evidenceRefs: never[];
        };
    };
    defaultsUsed: string[];
};
export {};
