import {
  parsePlanMarkdown as parseLegacyPlanMarkdown,
  type ParsedPlanResult,
  type TaskImportDiagnostic
} from './legacy/implementation.ts';
import { isCanonicalTaskIdDeclaration } from './canonical-task-id-boundary.ts';

export function parsePlanMarkdown(input: {
  readonly planText: string;
  readonly planRelativePath: string;
  readonly importedAt: string;
}): ParsedPlanResult {
  const parsed = parseLegacyPlanMarkdown(input);
  const diagnostics: TaskImportDiagnostic[] = [...parsed.diagnostics];
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

function collectFencedCodeLines(planText: string): ReadonlySet<number> {
  const fencedLines = new Set<number>();
  const lines = planText.split(/\r?\n/);
  let inFence = false;
  let fenceMarker: '`' | '~' | null = null;
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
      fenceMarker = match[1][0] as '`' | '~';
      fenceLength = match[1].length;
      fencedLines.add(lineNumber);
    }
  }

  return fencedLines;
}
