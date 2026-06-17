import { extractFrontMatter, normalizeTaskId } from '../../cli/src/commands/tasks/task-import-validators.ts';
import type {
  ExternalTaskSourcePlugin,
  ExternalTaskSourceInput,
  ParsedExternalTask,
  ExternalTaskValidationResult,
  ExternalTaskGenerationIntent,
  GeneratedExternalTaskCard
} from '@ai-atomic-framework/plugin-sdk';
import { loadTemplate, applyIntent } from './templates.ts';

export class AtmMarkdownTaskSourcePlugin implements ExternalTaskSourcePlugin {
  readonly kind = 'external-task-source';
  readonly id = 'atm.markdown-task-source';
  readonly version = '0.1.0';

  async parse(input: ExternalTaskSourceInput): Promise<ParsedExternalTask | null> {
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
    } as ParsedExternalTask;
  }

  async validate(parsed: ParsedExternalTask): Promise<ExternalTaskValidationResult> {
    const diagnostics: Array<{ code: string; level: 'error' | 'warning' | 'info'; message: string }> = [];
    const frontData = parsed.frontmatter;

    const rawTaskId = typeof frontData.task_id === 'string' ? frontData.task_id : '';
    if (!rawTaskId) {
      diagnostics.push({
        code: 'ATM_VALIDATION_MISSING_TASK_ID',
        level: 'warning',
        message: 'Front-matter is missing `task_id`.'
      });
    } else if (!/^(TASK|ATM)-[A-Z0-9]+-\d{4,5}$/i.test(rawTaskId)) {
      diagnostics.push({
        code: 'ATM_VALIDATION_INVALID_TASK_ID_FORMAT',
        level: 'warning',
        message: `Task ID '${rawTaskId}' does not match standard task pattern (TASK-XXX-0000 or ATM-XXX-0000).`
      });
    }

    const contextMap = frontData.contextMap as any;
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

  async generate(intent: ExternalTaskGenerationIntent): Promise<GeneratedExternalTaskCard> {
    const templateKey = intent.templateKey || 'aao-l2-split';
    const rawFields = intent.fields || {};
    const dependsOn = typeof rawFields.depends_on === 'string' ? rawFields.depends_on.trim() : '';
    const fields: Record<string, unknown> = {
      ...rawFields,
      depends_on_yaml: typeof rawFields.depends_on_yaml === 'string'
        ? rawFields.depends_on_yaml
        : dependsOn
          ? `  - ${dependsOn}`
          : '[]'
    };
    const template = loadTemplate(templateKey);
    const content = applyIntent(template, fields);
    const taskId = (fields.task_id as string) || 'TASK-UNKNOWN-0000';
    const sourcePath = (fields.sourcePath as string) || `tasks/${taskId}.task.md`;
    return { taskId, sourcePath, content };
  }
}

// Export default instance
const plugin = new AtmMarkdownTaskSourcePlugin();
export default plugin;
