/**
 * ATM versioning migration helper (Slice 1)
 *
 * This file maintains pure versioning logic and helpers for dataVersion and artifactVersion.
 * It is structured as a pure logic module:
 * - No file system operations
 * - No git executions
 * - No dependency on stores.ts or other stateful modules
 * - No runtime I/O
 */

/**
 * Validates whether a version string conforms to ATM's semantic versioning style (e.g. "0.1.0").
 * @param version The version string to validate
 */
export function isValidSemverVersionString(version: string): boolean {
  if (!version) return false;
  // Standard semver regex: major.minor.patch
  const semverRegex = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;
  return semverRegex.test(version);
}

/**
 * Additive coexistence resolver. Extracts or prepares dataVersion and artifactVersion.
 * Falls back safely to specVersion if the new versions are absent.
 * @param params Object containing specVersion, dataVersion, and/or artifactVersion
 */
export function resolveDataAndArtifactVersions(params: {
  specVersion?: string;
  dataVersion?: string;
  artifactVersion?: string;
}): {
  dataVersion: string;
  artifactVersion: string;
} {
  const fallback = params.specVersion || '0.1.0';
  return {
    dataVersion: params.dataVersion || fallback,
    artifactVersion: params.artifactVersion || fallback
  };
}

/**
 * Simple semantic version comparator.
 * Returns:
 *   1 if a > b
 *  -1 if a < b
 *   0 if a === b
 * @param a First version string
 * @param b Second version string
 */
export function compareSemverVersions(a: string, b: string): number {
  if (a === b) return 0;
  
  const parsePart = (v: string) => {
    const clean = v.split('-')[0].split('+')[0];
    return clean.split('.').map(Number);
  };

  const aParts = parsePart(a);
  const bParts = parsePart(b);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }
  
  return 0;
}
