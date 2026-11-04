export declare const propagationTriggerBehaviors: readonly string[];
export declare const defaultPropagationReportMigration: Readonly<{
    strategy: "none";
    fromVersion: null;
    notes: "Initial propagation report contract.";
}>;
interface DiscoverMapsOptions {
    repositoryRoot?: string;
    registryDocument?: RegistryDocument | null;
    registryPath?: string;
}
interface RunPropagationOptions extends DiscoverMapsOptions {
    behavior?: string | null;
    now?: string;
    writeReport?: boolean;
}
interface MapMember {
    atomId?: string;
}
interface RegistryEntry {
    schemaId?: string;
    mapId?: string;
    members?: MapMember[];
}
interface RegistryDocument {
    entries?: RegistryEntry[];
}
interface PerMapStatus {
    mapId: string;
    ok: boolean;
    exitCode: number;
    durationMs: number;
    resolutionMode: 'legacy' | 'canonical';
    reportPath: string;
    stdout?: string;
    stderr?: string;
    warnings: string[];
}
export declare function shouldPropagateBehavior(behavior: string | null | undefined): boolean;
export declare function discoverMapsForAtom(atomId: string, options: DiscoverMapsOptions | null | undefined): string[];
export declare function runPropagationIntegration(atomId: string, options: RunPropagationOptions | null | undefined): {
    ok: boolean;
    atomId: string;
    behavior: string | null;
    skipped: boolean;
    discoveredMaps: string[];
    perMapStatus: PerMapStatus[];
    failedDownstream: string[];
    propagationDuration: number;
    metrics: {
        latency: number;
        errorRate: number;
        coverage: number | null;
        edgeCaseCount: number;
    };
    summary: {
        total: number;
        passed: number;
        failed: number;
        durationMs: number;
    };
};
interface PropagationInput {
    atomId?: string;
    behavior?: string | null;
    discoveredMaps?: string[];
    perMapStatus?: Array<Partial<PerMapStatus>>;
    failedDownstream?: string[];
    propagationDuration?: number;
    metrics?: unknown;
    ok?: boolean;
    summary?: {
        total?: number;
        passed?: number;
        failed?: number;
        durationMs?: number;
    };
}
interface CreatePropagationReportOptions {
    atomId?: string;
    behaviorId?: string | null;
    reportId?: string;
    generatedAt?: string;
}
export declare function createPropagationReport(propagation: PropagationInput | null | undefined, options?: CreatePropagationReportOptions): {
    discoveredMaps: string[];
    perMapStatus: PerMapStatus[];
    failedDownstream: string[];
    propagationDuration: number;
    metrics: {};
    summary: {
        total: number;
        passed: number;
        failed: number;
        durationMs: number;
    };
    passed: boolean;
    behaviorId?: string | undefined;
    schemaId: string;
    specVersion: string;
    migration: Readonly<{
        strategy: "none";
        fromVersion: null;
        notes: "Initial propagation report contract.";
    }>;
    reportId: string;
    generatedAt: string;
    atomId: string;
};
export declare function validatePropagationReport(report: Record<string, unknown> | null | undefined, options?: {
    atomId?: string;
    mapId?: string;
}): {
    ok: boolean;
    issues: string[];
};
export {};
