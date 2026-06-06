import { normalizeStringValue } from './normalize-string-value-helper.js';
/**
 * Helper for `normalizeTaskDocumentId` leaf.
 */
export function normalizeTaskDocumentId(document, fallback) {
    return normalizeStringValue(document.workItemId ?? document.id ?? document.task_id ?? document.taskId) ?? fallback;
}
