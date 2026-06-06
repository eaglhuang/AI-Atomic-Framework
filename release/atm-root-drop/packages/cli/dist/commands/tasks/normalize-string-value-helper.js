/**
 * Helper for `normalizeStringValue` leaf.
 */
export function normalizeStringValue(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
