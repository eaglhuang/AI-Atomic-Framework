/**
 * task-markdown-helpers.ts
 *
 * Markdown parsing / metadata-packing helpers extracted from tasks.ts.
 * These functions are pure (no side effects) and work with generic interfaces
 * to avoid circular dependency issues.
 */
/**
 * Collects a key-value pair from markdown Heading Sections.
 */
export function collectKeyValue(sections, key) {
    const keyLower = key.toLowerCase();
    for (const section of sections) {
        for (const line of section.lines) {
            const match = /^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.+?)\s*$/.exec(line);
            if (match && match[1].toLowerCase() === keyLower) {
                return match[2];
            }
        }
    }
    return null;
}
/**
 * Collects a key-value pair from raw line lists.
 */
export function collectKeyValueFromLines(lines, key) {
    const keyLower = key.toLowerCase();
    for (const line of lines) {
        const match = /^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.+?)\s*$/.exec(line);
        if (match && match[1].toLowerCase() === keyLower) {
            return match[2].trim();
        }
    }
    return null;
}
/**
 * Packs table metadata into structural TaskImportRecord-compatible format.
 * hashSection 由呼叫方透過 createContext 傳入，避免循環依賴。
 */
export function createTaskFromTableMetadata(input) {
    return {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: input.metadata.workItemId,
        title: input.metadata.title,
        status: input.metadata.status,
        milestone: input.metadata.milestone,
        dependencies: input.metadata.dependencies,
        acceptance: [],
        deliverables: input.metadata.deliverables,
        tags: [],
        notes: null,
        source: {
            planPath: input.planRelativePath,
            sectionTitle: input.metadata.title,
            headingLine: input.metadata.headingLine,
            hash: input.hashSection(input.metadata.rowText)
        },
        importedAt: input.importedAt
    };
}
