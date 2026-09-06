const SHA256_DIGEST_PATTERN = /^sha256:([a-fA-F0-9]{64})$/;

/** Normalize a canonical SHA-256 digest without changing non-digest text. */
export function normalizeSha256DigestValue(value: string): string {
  const trimmed = value.trim();
  const match = SHA256_DIGEST_PATTERN.exec(trimmed);
  if (!match) return trimmed;
  return `sha256:${match[1].toLowerCase()}`;
}

/** Normalize every SHA-256 digest nested in an evidence value. */
export function normalizeSha256FieldsDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSha256FieldsDeep(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = normalizeSha256FieldsDeep(entry);
    }
    return next as T;
  }
  if (typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value.trim())) {
    return normalizeSha256DigestValue(value) as T;
  }
  return value;
}

