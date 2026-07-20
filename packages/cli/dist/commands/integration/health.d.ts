import type { InstallManifest, IntegrationAdapter } from '../../../../integrations-core/src/index.ts';
import type { InstallManifestWithTeamRuntimeCapabilities } from './types.ts';
export declare function checkIntegrationHealth(repositoryRoot: string): Promise<{
    ok: boolean;
    manifestDir: string;
    installed: string[];
    manifests: {
        ok: boolean;
        status: string;
        manifestPath: string;
        adapterId: string | null;
        findings: readonly unknown[];
        driftedFiles: readonly string[];
        staleFields: any[];
        teamRuntimeCapabilities: any[];
    }[];
    failed: {
        ok: boolean;
        status: string;
        manifestPath: string;
        adapterId: string | null;
        findings: readonly unknown[];
        driftedFiles: readonly string[];
        staleFields: any[];
        teamRuntimeCapabilities: any[];
    }[];
    teamRuntimeBackends: {
        schemaId: string;
        ok: boolean;
        manifestDir: string;
        declaredBackendCount: number;
        capabilities: {
            manifestPath: string;
            adapterId: string;
            providerId: any;
            runtimeModes: any;
            executionSurfaces: any;
            roles: any;
            status: any;
            evidence: any;
        }[];
        missingBackendSummary: string | null;
        startReadiness: "runtime-backend-declared" | "broker-only-only";
    };
}>;
export declare function inspectTeamRuntimeBackendCapabilities(repositoryRoot: string): {
    schemaId: string;
    ok: boolean;
    manifestDir: string;
    declaredBackendCount: number;
    capabilities: {
        manifestPath: string;
        adapterId: string;
        providerId: any;
        runtimeModes: any;
        executionSurfaces: any;
        roles: any;
        status: any;
        evidence: any;
    }[];
    missingBackendSummary: string | null;
    startReadiness: "runtime-backend-declared" | "broker-only-only";
};
export declare function normalizeTeamRuntimeCapabilities(manifest: InstallManifestWithTeamRuntimeCapabilities, manifestPath: string): {
    manifestPath: string;
    adapterId: string;
    providerId: any;
    runtimeModes: any;
    executionSurfaces: any;
    roles: any;
    status: any;
    evidence: any;
}[];
export declare function verifyManifestFile(repositoryRoot: string, entryName: string): Promise<{
    ok: boolean;
    status: string;
    manifestPath: string;
    adapterId: string | null;
    findings: readonly unknown[];
    driftedFiles: readonly string[];
    staleFields: any[];
    teamRuntimeCapabilities: any[];
}>;
export declare function verifyInstalledManifest(repositoryRoot: string, manifestPath: string, adapter: IntegrationAdapter, preloadedManifest?: InstallManifest): Promise<{
    ok: boolean;
    status: string;
    manifestPath: string;
    adapterId: string | null;
    findings: readonly unknown[];
    driftedFiles: readonly string[];
    staleFields: any[];
    teamRuntimeCapabilities: any[];
}>;
export declare function compareManifestParity(installed: InstallManifest, expected: InstallManifest): {
    ok: boolean;
    changedFields: string[];
    changedFiles: string[];
};
export declare function readIntegrationManifest(repositoryRoot: string, adapterId: string): InstallManifest;
