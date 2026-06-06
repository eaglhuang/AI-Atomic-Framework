import type { CodexSkillsAdapterOptions, CreateInstallManifestInput, InstallManifest, InstallManifestFile, IntegrationAdapter, IntegrationFileFormat, IntegrationSourceFile, StaticIntegrationAdapterInput } from './types.ts';
export declare function createInstallManifest(input: CreateInstallManifestInput): InstallManifest;
export declare function createManifestFileRecord(input: {
    readonly path: string;
    readonly content: string | Uint8Array;
    readonly source: InstallManifestFile['source'];
    readonly fileFormat: IntegrationFileFormat;
}): InstallManifestFile;
export declare function createCodexSkillsAdapter(sourceFiles: readonly IntegrationSourceFile[], options?: CodexSkillsAdapterOptions): IntegrationAdapter;
export declare function createStaticIntegrationAdapter(input: StaticIntegrationAdapterInput): IntegrationAdapter;
