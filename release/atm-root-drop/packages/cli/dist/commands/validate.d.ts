export declare function runValidate(argv: any): import("./shared.ts").CommandResult;
/**
 * TASK-MAO-0042: 依據 Validator Scope Taxonomy 分類 gate 的範疇
 */
export declare function getValidatorScope(gateName: string, touchedFiles?: readonly string[]): 'task-local' | 'global-advisory' | 'release-blocking' | 'diagnostic';
