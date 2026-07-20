import type { AllocateOptions, GenerateAtomicMapOptions, MapIdAllocationRecord, MapPaths, NormalizedRequest, PhaseRecord, RegistryDocument, RegistryEntry, RunTestOptions } from './types.ts';
export declare function readRegistryDocument(registryAbsolutePath: string, options: GenerateAtomicMapOptions): RegistryDocument;
export declare function findExistingEntry(registryDocument: RegistryDocument, request: NormalizedRequest): RegistryEntry | null;
export declare function allocateGeneratorMapId(request: NormalizedRequest, options: AllocateOptions): MapIdAllocationRecord;
export declare function upsertRegistryEntry(registryDocument: RegistryDocument, registryEntry: RegistryEntry, options?: {
    generatedAt?: string;
}): RegistryDocument;
export declare function createMapPaths(mapId: string): MapPaths;
export declare function createMapLocation(paths: MapPaths): {
    specPath: string;
    codePaths: never[];
    testPaths: string[];
    reportPath: string;
    workbenchPath: string;
};
export declare function createGeneratedMapEvidence(paths: MapPaths): string[];
export declare function renderDefaultMapIntegrationTest(specDocument: Record<string, unknown>): string;
export declare function runGeneratedMapTest(options: RunTestOptions): {
    ok: boolean;
    report: {
        mapId: string;
        executedAt: string;
        command: string[];
        specPath: string;
        ok: boolean;
        exitCode: number;
        stdout: string;
        stderr: string;
    };
};
export declare function recordPhase<T>(phases: PhaseRecord[], phase: string, action: () => T): T;
export declare function normalizeError(error: unknown): {
    code: string;
    message: string;
    details: Record<string, unknown>;
};
export declare function normalizeTrailingNewline(value: string): string;
export declare function toPortablePath(value: string): string;
