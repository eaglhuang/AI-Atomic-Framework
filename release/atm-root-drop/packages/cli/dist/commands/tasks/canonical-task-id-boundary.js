/**
 * Canonical task-card id extraction for markdown plan import declarations.
 *
 * This contract is intentionally stricter than the runtime ledger's historical
 * task-id tolerance: plan import may discover task declarations from prose-like
 * headings and table cells, so it must not accept numeric prefixes such as
 * `ATM-GOV-018` from `ATM-GOV-018x` or `ATM-GOV-01820`.
 */
export const CANONICAL_TASK_ID_SOURCE = String.raw `(?:TASK-)?[A-Z][A-Z0-9-]*(?:-[A-Z0-9]+)*-\d{4,5}`;
export const CANONICAL_TASK_ID_RIGHT_BOUNDARY_SOURCE = String.raw `(?![A-Z0-9-])`;
export const canonicalTaskIdAtStartPattern = new RegExp(`^${CANONICAL_TASK_ID_SOURCE}${CANONICAL_TASK_ID_RIGHT_BOUNDARY_SOURCE}`, 'i');
export const canonicalTaskIdAnywherePattern = new RegExp(`(?:^|[^A-Z0-9-])(${CANONICAL_TASK_ID_SOURCE})${CANONICAL_TASK_ID_RIGHT_BOUNDARY_SOURCE}`, 'i');
export function extractCanonicalTaskIdAtStart(value) {
    return canonicalTaskIdAtStartPattern.exec(value)?.[0] ?? null;
}
export function extractCanonicalTaskId(value) {
    const match = canonicalTaskIdAnywherePattern.exec(value);
    return match?.[1] ?? null;
}
export function isCanonicalTaskIdDeclaration(value) {
    const normalized = value.trim();
    return canonicalTaskIdAtStartPattern.exec(normalized)?.[0] === normalized;
}
