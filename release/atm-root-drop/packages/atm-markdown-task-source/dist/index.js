import { extractFrontMatter, normalizeTaskId } from '../../cli/dist/commands/tasks/task-import-validators.js';
import { loadTemplate, applyIntent } from './templates.js';
export class AtmMarkdownTaskSourcePlugin {
    kind = 'external-task-source';
    id = 'atm.markdown-task-source';
    version = '0.1.0';
    async parse(input) {
        const frontMatter = extractFrontMatter(input.raw);
        if (!frontMatter) {
            return null;
        }
        const rawTaskId = frontMatter.data.task_id || frontMatter.data.id;
        if (typeof rawTaskId !== 'string') {
            return null;
        }
        const taskId = normalizeTaskId(rawTaskId);
        const body = input.raw.slice(frontMatter.endIndex);
        return {
            taskId,
            frontmatter: {
                ...frontMatter.data,
                task_id: rawTaskId
            },
            body,
            sourcePath: input.sourcePath,
            contextMap: frontMatter.data.contextMap
        };
    }
    async validate(parsed) {
        const diagnostics = [];
        const frontData = parsed.frontmatter;
        const rawTaskId = typeof frontData.task_id === 'string' ? frontData.task_id : '';
        if (!rawTaskId) {
            diagnostics.push({
                code: 'ATM_VALIDATION_MISSING_TASK_ID',
                level: 'warning',
                message: 'Front-matter is missing `task_id`.'
            });
        }
        else if (!/^(TASK|ATM)-[A-Z0-9]+-\d{4,5}$/i.test(rawTaskId)) {
            diagnostics.push({
                code: 'ATM_VALIDATION_INVALID_TASK_ID_FORMAT',
                level: 'warning',
                message: `Task ID '${rawTaskId}' does not match standard task pattern (TASK-XXX-0000 or ATM-XXX-0000).`
            });
        }
        const contextMap = frontData.contextMap;
        if (!contextMap || !Array.isArray(contextMap.primary) || contextMap.primary.length === 0) {
            diagnostics.push({
                code: 'ATM_VALIDATION_MISSING_PRIMARY_CONTEXT',
                level: 'warning',
                message: 'Task is missing a primary context file in `contextMap.primary`.'
            });
        }
        const deliverables = frontData.deliverables;
        if (!deliverables || (Array.isArray(deliverables) && deliverables.length === 0)) {
            diagnostics.push({
                code: 'ATM_VALIDATION_MISSING_DELIVERABLES',
                level: 'warning',
                message: 'Task has no deliverables defined.'
            });
        }
        return { ok: true, diagnostics };
    }
    async generate(intent) {
        const templateKey = intent.templateKey || 'aao-l2-split';
        const fields = intent.fields || {};
        const template = loadTemplate(templateKey);
        const content = applyIntent(template, fields);
        const taskId = fields.task_id || 'TASK-UNKNOWN-0000';
        const sourcePath = fields.sourcePath || `tasks/${taskId}.task.md`;
        return { taskId, sourcePath, content };
    }
}
// Export default instance
const plugin = new AtmMarkdownTaskSourcePlugin();
export default plugin;
