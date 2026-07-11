export {
  parsePlanMarkdown,
  detectPlanHeadings,
  parseSingleCardFromPlugin,
  uniqueStrings
} from '../../cli/src/commands/tasks/legacy-impl.ts';

export type {
  ParsedPlanResult,
  TaskImportRecord,
  TaskImportDiagnostic,
  TaskCardImportDiagnostic
} from '../../cli/src/commands/tasks/legacy-impl.ts';
