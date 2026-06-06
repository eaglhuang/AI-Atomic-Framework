import { normalizeStringValue } from './normalize-string-value-helper.ts';

/**
 * Helper for `normalizeTaskDocumentId` leaf.
 */
export function normalizeTaskDocumentId(document: Record<string, unknown>, fallback: string): string {
  return normalizeStringValue(document.workItemId ?? document.id ?? document.task_id ?? document.taskId) ?? fallback;
}
