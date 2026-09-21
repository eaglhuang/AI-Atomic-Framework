const SHA256_DIGEST_PATTERN = /^sha256:([a-fA-F0-9]{64})$/;
/** Normalize a canonical SHA-256 digest without changing non-digest text. */
export function normalizeSha256DigestValue(value) {
    const trimmed = value.trim();
    const match = SHA256_DIGEST_PATTERN.exec(trimmed);
    if (!match)
        return trimmed;
    return `sha256:${match[1].toLowerCase()}`;
}
/** Normalize every SHA-256 digest nested in an evidence value. */
export function normalizeSha256FieldsDeep(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeSha256FieldsDeep(entry));
    }
    if (value && typeof value === 'object') {
        const next = {};
        for (const [key, entry] of Object.entries(value)) {
            next[key] = normalizeSha256FieldsDeep(entry);
        }
        return next;
    }
    if (typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value.trim())) {
        return normalizeSha256DigestValue(value);
    }
    return value;
}
