const SHA256_DIGEST_PATTERN = /^sha256:([a-fA-F0-9]{64})$/;
const SHA256_LOWER_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHA256_FORMAT_EXPECTED = '^sha256:[a-f0-9]{64}$';
export function summarizeSha256ActualValue(value) {
    if (typeof value !== 'string')
        return typeof value;
    if (value.length <= 32)
        return value;
    return `${value.slice(0, 16)}...${value.slice(-8)} (len=${value.length})`;
}
export function pushSha256ValidationIssue(issues, path, value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        issues.missing.push(path);
        return;
    }
    if (!SHA256_DIGEST_PATTERN.test(value) || !SHA256_LOWER_PATTERN.test(value)) {
        issues.invalidFormat.push({
            path,
            kind: 'invalidFormat',
            formatExpected: SHA256_FORMAT_EXPECTED,
            actualValue: summarizeSha256ActualValue(value)
        });
    }
}
