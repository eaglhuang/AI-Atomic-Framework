import { extractFrontMatter, normalizeTaskId } from '../../cli/src/commands/tasks/task-import-validators.ts';
import type {
  ExternalTaskSourcePlugin,
  ExternalTaskSourceInput,
  ParsedExternalTask
} from '@ai-atomic-framework/plugin-sdk';

export class AtmMarkdownTaskSourcePlugin implements ExternalTaskSourcePlugin {
  readonly kind = 'external-task-source';
  readonly id = 'atm.markdown-task-source';
  readonly version = '0.1.0';

  async parse(input: ExternalTaskSourceInput): Promise<ParsedExternalTask | null> {
    const frontMatter = extractFrontMatter(input.raw);
    if (!frontMatter || typeof frontMatter.data.task_id !== 'string') {
      return null;
    }

    const taskId = normalizeTaskId(frontMatter.data.task_id);
    const body = input.raw.slice(frontMatter.endIndex);

    return {
      taskId,
      frontmatter: frontMatter.data,
      body,
      sourcePath: input.sourcePath,
      contextMap: frontMatter.data.contextMap
    } as ParsedExternalTask;
  }
}

// Export default instance
const plugin = new AtmMarkdownTaskSourcePlugin();
export default plugin;
