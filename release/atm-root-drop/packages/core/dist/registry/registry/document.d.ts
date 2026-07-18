import type { RegistryDocumentOptions, WriteRegistryArtifactsOptions } from './types.ts';
export declare function createRegistryDocument(entries: unknown[], options?: RegistryDocumentOptions): Record<string, unknown>;
export declare function writeRegistryArtifacts(registryDocument: Record<string, unknown>, options?: WriteRegistryArtifactsOptions): {
    registryPath: string;
    catalogPath: string | null;
};
