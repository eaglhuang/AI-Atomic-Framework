import type { InstallIntegrationOptions } from './types.ts';
export declare function installIntegrationAdapter(repositoryRoot: string, adapterId: string, options?: InstallIntegrationOptions): Promise<{
    adapter: {
        id: import("@ai-atomic-framework/integrations-core").IntegrationAdapterId;
        displayName: string;
        adapterVersion: string;
        targetDir: string;
        fileFormat: import("@ai-atomic-framework/integrations-core").IntegrationFileFormat;
        placeholderStyle: import("@ai-atomic-framework/integrations-core").IntegrationPlaceholderStyle;
        manifestPath: string;
        installed: boolean;
    };
    dryRun: boolean;
    manifestPath: string;
    writtenFiles: readonly string[];
    existingTargetFiles: string[];
    manifest: import("@ai-atomic-framework/integrations-core").InstallManifest;
}>;
