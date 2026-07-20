/**
 * Semver helpers extracted from `atm-chart.ts` so they can be unit-tested
 * and re-used by compatibility / version-cache code without dragging the
 * full atm-chart command surface along.
 *
 * Compares major.minor.patch first, then prerelease tag (empty > non-empty,
 * lexicographic within). Throws `CliError(ATM_VERSION_INVALID, exitCode=2)`
 * on malformed input.
 */
import { CliError } from '../shared.js';
const semverPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
export function parseSemver(version) {
    const match = String(version).trim().match(semverPattern);
    if (!match) {
        throw new CliError('ATM_VERSION_INVALID', `Invalid semver version: ${version}`, { exitCode: 2 });
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ?? ''
    };
}
export function isSemver(version) {
    try {
        parseSemver(version);
        return true;
    }
    catch {
        return false;
    }
}
export function compareSemver(left, right) {
    const parsedLeft = parseSemver(left);
    const parsedRight = parseSemver(right);
    for (const key of ['major', 'minor', 'patch']) {
        if (parsedLeft[key] !== parsedRight[key]) {
            return parsedLeft[key] > parsedRight[key] ? 1 : -1;
        }
    }
    if (parsedLeft.prerelease === parsedRight.prerelease)
        return 0;
    if (!parsedLeft.prerelease)
        return 1;
    if (!parsedRight.prerelease)
        return -1;
    return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}
/** Return the higher of two semver strings, treating null right as -∞. */
export function higherVersion(left, right) {
    if (!right)
        return left;
    return compareSemver(left, right) >= 0 ? left : right;
}
/** Alias of higherVersion preserved for clarity in the cache-update code path. */
export function highestVersion(left, right) {
    return higherVersion(left, right);
}
/** Normalize an unknown value into a trimmed semver string or null. */
export function asOptionalVersion(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
