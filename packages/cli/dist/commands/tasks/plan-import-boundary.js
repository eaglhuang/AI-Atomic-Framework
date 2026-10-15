import { parsePlanMarkdown as parseLegacyPlanMarkdown, parseSingleCardFromPlugin } from './legacy/implementation.js';
import { isCanonicalTaskIdDeclaration } from './canonical-task-id-boundary.js';
import { extractFrontMatter, normalizeTaskId } from './task-import-validators.js';
export function parsePlanMarkdown(input) {
    const frontMatter = extractFrontMatter(input.planText);
    const declaredId = frontMatter?.data.task_id ?? frontMatter?.data.id;
    // Match the external markdown source contract without rewriting the card or
    // inventing an alias in the runtime ledger. Explicit task_id keeps precedence.
    const parsed = frontMatter && typeof declaredId === 'string' && !frontMatter.data.task_id
        && isCanonicalTaskIdDeclaration(normalizeTaskId(declaredId))
        ? {
            tasks: [parseSingleCardFromPlugin({
                    taskId: declaredId,
                    frontmatter: frontMatter.data,
                    body: input.planText.slice(frontMatter.endIndex),
                    sourcePath: input.planRelativePath
                }, input.importedAt)],
            diagnostics: []
        }
        : parseLegacyPlanMarkdown(input);
    const diagnostics = [...parsed.diagnostics];
    const fencedCodeLines = collectFencedCodeLines(input.planText);
    const tasks = parsed.tasks.filter((task) => {
        if (fencedCodeLines.has(task.source.headingLine)) {
            diagnostics.push({
                level: 'warning',
                code: 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT',
                text: `Ignored task-like example ${task.workItemId}; plan import declarations must not originate inside fenced code blocks.`,
                workItemId: task.workItemId,
                sourceLine: task.source.headingLine
            });
            return false;
        }
        if (isCanonicalTaskIdDeclaration(task.workItemId)) {
            return true;
        }
        diagnostics.push({
            level: 'warning',
            code: 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT',
            text: `Ignored non-canonical task id fragment ${task.workItemId}; plan import declarations require a complete task id with a 4-5 digit numeric suffix and a right boundary.`,
            workItemId: task.workItemId,
            sourceLine: task.source.headingLine
        });
        return false;
    });
    return { tasks, diagnostics };
}
function collectFencedCodeLines(planText) {
    const fencedLines = new Set();
    const lines = planText.split(/\r?\n/);
    let inFence = false;
    let fenceMarker = null;
    let fenceLength = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const match = /^\s*(`{3,}|~{3,})/.exec(lines[index]);
        if (inFence) {
            fencedLines.add(lineNumber);
            if (match && fenceMarker && match[1].startsWith(fenceMarker) && match[1].length >= fenceLength) {
                inFence = false;
                fenceMarker = null;
                fenceLength = 0;
            }
            continue;
        }
        if (match) {
            inFence = true;
            fenceMarker = match[1][0];
            fenceLength = match[1].length;
            fencedLines.add(lineNumber);
        }
    }
    return fencedLines;
}
