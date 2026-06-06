export declare const installManifestSchemaVersion: "atm.installManifest.v0.1";
export declare const legacyInstallManifestSchemaVersion: "atm.installManifest.v0.0";
export type InstallManifestSchemaVersion = typeof installManifestSchemaVersion | typeof legacyInstallManifestSchemaVersion;
export interface InstallManifestSchemaWarning {
    readonly code: 'ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION' | 'ATM_INSTALL_MANIFEST_UNKNOWN_SCHEMA_VERSION';
    readonly level: 'warning';
    readonly text: string;
    readonly schemaVersion: string;
    readonly migrationHint: string;
}
export interface NormalizedInstallManifestVersion {
    readonly schemaVersion: InstallManifestSchemaVersion | string;
    readonly isLegacy: boolean;
    readonly warnings: readonly InstallManifestSchemaWarning[];
}
export declare function readInstallManifestSchemaVersion(manifest: unknown): NormalizedInstallManifestVersion;
export declare function assertInstallManifestSchemaVersion(manifest: unknown): NormalizedInstallManifestVersion;
