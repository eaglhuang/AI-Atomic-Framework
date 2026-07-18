import type { InstallManifest } from '../../../../integrations-core/src/index.ts';
export type GovernedVendorConfigSurface = {
    rootDir: string;
    templateReadme: string;
    exists: boolean;
};
export type IntegrationTeamRuntimeCapability = {
    readonly providerId: string;
    readonly runtimeModes: readonly string[];
    readonly executionSurfaces: readonly string[];
    readonly roles: readonly string[];
    readonly status: 'supported' | 'experimental' | 'unavailable';
    readonly evidence: string;
};
export type InstallManifestWithTeamRuntimeCapabilities = InstallManifest & {
    readonly teamRuntimeCapabilities?: readonly IntegrationTeamRuntimeCapability[];
};
export interface InstallIntegrationOptions {
    readonly actor?: string;
    readonly now?: string;
    readonly dryRun?: boolean;
    readonly force?: boolean;
}
