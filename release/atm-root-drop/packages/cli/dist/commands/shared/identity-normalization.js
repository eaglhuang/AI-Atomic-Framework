export function normalizeIdentitySegment(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}
export function mintFrameworkTempTaskId(actorId) {
    const normalized = normalizeIdentitySegment(actorId);
    return `ATM-FRAMEWORK-TEMP-${normalized || 'unknown-actor'}`;
}
