const SEMVER_BASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Returns the immutable release-train portion of a SemVer value. A leading
 * `v` is accepted for Git tags, but malformed SemVer is rejected rather than
 * compared as a loosely formatted string.
 */
export function releaseVersionBase(value: string): string | null {
  const normalized = value.trim().replace(/^v/, '');
  const match = SEMVER_BASE_PATTERN.exec(normalized);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/**
 * Normal validation requires byte-for-byte version equality. During a tagged
 * prerelease publish, npm has already rewritten workspace manifests to the
 * prerelease while bundled release metadata still reports the stable train;
 * in that one lifecycle phase the stable SemVer bases must agree.
 */
export function versionsMatchReleaseTrain(
  expected: string,
  actual: string,
  options: { readonly allowPrereleaseBase: boolean }
): boolean {
  if (!options.allowPrereleaseBase) return expected === actual;
  const expectedBase = releaseVersionBase(expected);
  const actualBase = releaseVersionBase(actual);
  return expectedBase !== null && actualBase !== null && expectedBase === actualBase;
}

export function releaseVersionSourcesAreCompatible(input: {
  readonly releaseTag: string | null;
  readonly rootPackageVersion: string;
  readonly releaseTrainVersion: string;
  readonly runtimeFrameworkVersion?: string;
}): boolean {
  const allowPrereleaseBase = input.releaseTag !== null;
  const expectedVersion = input.releaseTag
    ? releaseVersionBase(input.releaseTag)
    : input.rootPackageVersion;
  if (!expectedVersion) return false;

  const observedVersions = [
    input.rootPackageVersion,
    input.releaseTrainVersion,
    input.runtimeFrameworkVersion
  ].filter((value): value is string => typeof value === 'string');

  return observedVersions.every((value) => versionsMatchReleaseTrain(expectedVersion, value, { allowPrereleaseBase }));
}
