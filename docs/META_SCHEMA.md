# ATM Meta-schema Versioning

ATM artifacts use explicit schemaVersion strings so validators can distinguish artifact evolution from framework SemVer.

## Namespace

All new artifact schema versions use:

```text
atm.<artifact>.v<major>.<minor>
```

The artifact name is camelCase and stable. Major changes are breaking contract changes. Minor changes are additive and must preserve reader compatibility.

## Current Versions

| Artifact | Current schemaVersion | Legacy read behavior | Breaking change examples |
| --- | --- | --- | --- |
| CompatibilityMatrix | `atm.compatibilityMatrix.v0.1` | No legacy active matrix fallback except the bundled legacy matrix file. | Required release train field removal, status semantics change, unsupported entry policy change. |
| InstallManifest | `atm.installManifest.v0.1` | Missing `schemaVersion` is read as `atm.installManifest.v0.0` with warning `ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION`. | Required manifest field removal, file hash format change, target path semantics change. |
| ATMChart frontmatter | `atm.atmChart.v0.1` | Missing `schema_version` is read by validators as `atm.atmChart.v0.0`. | Removing required frontmatter keys, changing guard block semantics, requiring unsupported InstallManifest fields. |
| Charter invariants | `atm.invariants.v0.1` | Strict schema requires the field for new documents. | Changing invariant enforcement enum semantics, removing required invariant fields, changing waiver requirements. |

## Reader Policy

- New writers must emit the current schemaVersion.
- Strict validators reject missing schemaVersion for current-version fixtures.
- Compatibility readers may continue to read legacy artifacts when doing read-only diagnostics or upgrade planning.
- A legacy read must include a machine-readable warning and a migration hint.

## Validation

```bash
node --experimental-strip-types scripts/validate-meta-schema.ts --mode validate
```

The validator checks schema constants, strict fixture validation, legacy InstallManifest warning behavior, ATMChart rendering, and standard profile registration.
