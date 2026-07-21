export function normalizeIdentitySegment(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function mintFrameworkTempTaskId(actorId: string): string {
  const normalized = normalizeIdentitySegment(actorId);
  return `ATM-FRAMEWORK-TEMP-${normalized || 'unknown-actor'}`;
}
