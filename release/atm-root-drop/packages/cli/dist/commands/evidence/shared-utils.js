export function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
export function isCommandRunProof(value) {
    if (!isRecord(value))
        return false;
    return typeof value.exitCode === 'number'
        && typeof value.stdoutSha256 === 'string'
        && value.stdoutSha256.length > 0
        && typeof value.stderrSha256 === 'string'
        && value.stderrSha256.length > 0;
}
export function quoteForShell(arg) {
    if (/^[a-zA-Z0-9.\-_:/]+$/.test(arg))
        return arg;
    return `"${arg.replace(/"/g, '\\"')}"`;
}
