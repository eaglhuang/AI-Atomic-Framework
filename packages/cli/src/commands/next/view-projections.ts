import { createHash } from 'node:crypto';

export interface ImportedTaskSummary {
  readonly workItemId: string;
  readonly title: string;
  readonly status: string;
  readonly closedAt: string | null;
  readonly closedByActor: string | null;
  readonly closurePacket: string | null;
  readonly lastTransitionId: string | null;
  readonly lastTransitionAt: string | null;
  readonly taskPath: string;
  readonly format: 'json' | 'markdown';
  readonly sourcePlanPath: string | null;
  readonly nearbyPlanPaths: readonly string[];
  readonly scopePaths: readonly string[];
  readonly targetRepo: string | null;
  readonly allowPlanningMirror: boolean;
  readonly planningReadOnlyPaths: readonly string[];
  readonly targetAllowedFiles: readonly string[];
  readonly matchScore?: number;
  readonly matchReasons?: readonly string[];
}

export function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((entry) => String(entry).trim()).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function toTaskCandidateView(task: ImportedTaskSummary) {
  return {
    workItemId: task.workItemId,
    title: task.title,
    status: task.status,
    closedAt: task.closedAt,
    closedByActor: task.closedByActor,
    closurePacket: task.closurePacket,
    lastTransitionId: task.lastTransitionId,
    lastTransitionAt: task.lastTransitionAt,
    taskPath: task.taskPath,
    format: task.format,
    sourcePlanPath: task.sourcePlanPath,
    nearbyPlanPaths: task.nearbyPlanPaths,
    scopePaths: task.scopePaths,
    planningContext: {
      readOnlyPaths: task.planningReadOnlyPaths
    },
    targetWork: {
      allowedFiles: task.targetAllowedFiles,
      allowPlanningMirror: task.allowPlanningMirror
    },
    targetRepo: task.targetRepo,
    matchScore: task.matchScore ?? 0,
    matchReasons: task.matchReasons ?? []
  };
}

export function dedupeStrings(values: readonly string[]) {
  return Array.from(new Set(values));
}

export function quoteCliValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
