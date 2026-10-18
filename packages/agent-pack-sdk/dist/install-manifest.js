export const installManifestSchemaVersion = 'atm.installManifest.v0.1';
export const legacyInstallManifestSchemaVersion = 'atm.installManifest.v0.0';
export function readInstallManifestSchemaVersion(manifest) {
    const candidate = manifest && typeof manifest === 'object'
        ? manifest.schemaVersion
        : undefined;
    if (candidate === undefined || candidate === null || candidate === '') {
        return {
            schemaVersion: legacyInstallManifestSchemaVersion,
            isLegacy: true,
            warnings: [legacySchemaWarning()]
        };
    }
    if (candidate === installManifestSchemaVersion) {
        return {
            schemaVersion: installManifestSchemaVersion,
            isLegacy: false,
            warnings: []
        };
    }
    const schemaVersion = String(candidate);
    return {
        schemaVersion,
        isLegacy: false,
        warnings: [{
                code: 'ATM_INSTALL_MANIFEST_UNKNOWN_SCHEMA_VERSION',
                level: 'warning',
                text: `InstallManifest schemaVersion ${schemaVersion} is not known by this SDK.`,
                schemaVersion,
                migrationHint: 'Run `node atm.mjs upgrade plan --json` before mutating integration files.'
            }]
    };
}
export function assertInstallManifestSchemaVersion(manifest) {
    const result = readInstallManifestSchemaVersion(manifest);
    if (result.schemaVersion !== installManifestSchemaVersion && result.schemaVersion !== legacyInstallManifestSchemaVersion) {
        throw new Error(`Unsupported InstallManifest schemaVersion: ${result.schemaVersion}`);
    }
    return result;
}
function legacySchemaWarning() {
    return {
        code: 'ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION',
        level: 'warning',
        text: 'InstallManifest is missing schemaVersion and was read as atm.installManifest.v0.0 for compatibility.',
        schemaVersion: legacyInstallManifestSchemaVersion,
        migrationHint: 'Re-run the integration install or `node atm.mjs upgrade plan --json` to write atm.installManifest.v0.1.'
    };
}
