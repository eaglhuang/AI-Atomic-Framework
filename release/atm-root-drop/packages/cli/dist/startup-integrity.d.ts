/**
 * startup-integrity.ts
 *
 * Verifies that the bundled `compatibility-matrix.json` matches the
 * sha256 recorded in the co-bundled `release/integrity.json` manifest.
 *
 * Call `checkStartupIntegrity(root)` early in CLI boot.  When
 * `integrity.json` is absent (development installs, pre-release), the
 * function returns `{ ok: true, mode: 'no-manifest' }` so the CLI
 * continues unimpeded.  When the manifest IS present and the hash
 * mismatches, it returns `{ ok: false, ... }` and the caller MUST refuse
 * to proceed (read-only `doctor --trust` sub-mode is the only exception).
 */
export interface IntegrityArtefact {
    path: string;
    sha256: string;
}
export interface IntegrityManifest {
    schemaVersion: string;
    version: string;
    buildAt: string;
    artefacts: IntegrityArtefact[];
}
export type IntegrityCheckMode = 'no-manifest' | 'ok' | 'tampered' | 'missing-artefact' | 'parse-error';
export interface IntegrityCheckResult {
    ok: boolean;
    mode: IntegrityCheckMode;
    version: string | null;
    checks: Array<{
        path: string;
        bundledHash: string | null;
        expectedHash: string;
        match: boolean;
    }>;
}
export declare function resolveBundledIntegrityRoot(): string;
export declare function checkStartupIntegrity(frameworkRoot?: string): IntegrityCheckResult;
