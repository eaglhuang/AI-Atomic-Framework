import { CliError } from '../../shared.js';
export function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `tasks requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
export function normalizeRelativePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function stripMatchingOuterQuotes(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1).trim();
        }
    }
    return trimmed;
}
function stripBoundaryQuoteArtifacts(value) {
    return stripMatchingOuterQuotes(value).replace(/^["']+|["']+$/g, '').trim();
}
export function parseCsvPathList(value) {
    return stripBoundaryQuoteArtifacts(value)
        .split(',')
        .map((pathValue) => stripBoundaryQuoteArtifacts(pathValue))
        .filter(Boolean);
}
export function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
export function parseAllowStaleRunnerFlag(argv) {
    return argv.includes('--allow-stale-runner');
}
