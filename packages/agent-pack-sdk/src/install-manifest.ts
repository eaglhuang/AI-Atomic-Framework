export const installManifestSchemaVersion = 'atm.installManifest.v0.1' as const;
export const legacyInstallManifestSchemaVersion = 'atm.installManifest.v0.0' as const;

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

export function readInstallManifestSchemaVersion(manifest: unknown): NormalizedInstallManifestVersion {
  const candidate = manifest && typeof manifest === 'object'
    ? (manifest as { readonly schemaVersion?: unknown }).schemaVersion
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

export function assertInstallManifestSchemaVersion(manifest: unknown): NormalizedInstallManifestVersion {
  const result = readInstallManifestSchemaVersion(manifest);
  if (result.schemaVersion !== installManifestSchemaVersion && result.schemaVersion !== legacyInstallManifestSchemaVersion) {
    throw new Error(`Unsupported InstallManifest schemaVersion: ${result.schemaVersion}`);
  }
  return result;
}

function legacySchemaWarning(): InstallManifestSchemaWarning {
  return {
    code: 'ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION',
    level: 'warning',
    text: 'InstallManifest is missing schemaVersion and was read as atm.installManifest.v0.0 for compatibility.',
    schemaVersion: legacyInstallManifestSchemaVersion,
    migrationHint: 'Re-run the integration install or `node atm.mjs upgrade plan --json` to write atm.installManifest.v0.1.'
  };
}
