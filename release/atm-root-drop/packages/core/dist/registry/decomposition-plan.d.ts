import type { RegistryMapEdgeRecord, RegistryMapMemberRecord, RegistryMapQualityTargetValue } from '../index';
export declare const defaultDecompositionPlanSchemaPath: string;
export declare function readDecompositionPlan(planPath: string, options?: any): {
    plan: any;
    absolutePlanPath: string;
    relativePlanPath: string;
    validation: {
        ok: boolean;
        schemaPath: string;
        issues: {
            path: string;
            keyword: string;
            message: string;
            params: Record<string, unknown>;
        }[];
    };
};
export declare function validateDecompositionPlanDocument(document: unknown, options?: any): {
    ok: boolean;
    schemaPath: string;
    issues: {
        path: string;
        keyword: string;
        message: string;
        params: Record<string, unknown>;
    }[];
};
export declare function createAtomicMapRequestFromDecompositionPlan(plan: any): {
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
