import { existsSync, readFileSync } from 'node:fs';
import { taskPathFor } from './task-file-io-helpers.ts';
import { parseYamlList } from './task-import-validators.ts';
import { normalizeWorkItemStatus } from './task-transition-helpers.ts';
import {
  buildDependencyCloseoutBlocker,
  verifyCloseoutProvenance,
  type TaskDependencyCloseoutBlocker
} from './closeout-provenance.ts';

export type TaskClaimDependencyBlocker = TaskDependencyCloseoutBlocker;

export interface TaskDependencyRouteSummary {
  readonly workItemId: string;
  readonly dependencies: readonly string[];
}

function readTaskDocument(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function declaredDependenciesFor(taskDocument: Record<string, unknown>): readonly string[] {
  return Array.from(new Set(parseYamlList(
    taskDocument.dependencies ?? taskDocument.depends_on ?? taskDocument.blocked_by
  )));
}

function isDependencyStatusClosed(status: unknown): boolean {
  const normalized = normalizeWorkItemStatus(status);
  return normalized === 'done' || normalized === 'verified';
}

export function findTaskClaimDependencyBlockers(
  cwd: string,
  taskId: string,
  taskDocument: Record<string, unknown>
): TaskClaimDependencyBlocker[] {
  const declaredDependencies = declaredDependenciesFor(taskDocument);
  if (declaredDependencies.length === 0) {
    return [];
  }
  const blockers: TaskClaimDependencyBlocker[] = [];
  for (const dependencyTaskId of declaredDependencies) {
    if (dependencyTaskId === taskId) {
      continue;
    }
    const dependencyPath = taskPathFor(cwd, dependencyTaskId);
    if (!existsSync(dependencyPath)) {
      blockers.push({ taskId: dependencyTaskId, status: 'missing', taskPath: dependencyPath });
      continue;
    }
    const dependencyDocument = readTaskDocument(dependencyPath);
    if (!dependencyDocument) {
      blockers.push({ taskId: dependencyTaskId, status: 'unreadable', taskPath: dependencyPath });
      continue;
    }
    const dependencyStatus = normalizeWorkItemStatus(dependencyDocument.status);
    if (!isDependencyStatusClosed(dependencyStatus)) {
      blockers.push({ taskId: dependencyTaskId, status: dependencyStatus, taskPath: dependencyPath });
      continue;
    }
    if (!verifyCloseoutProvenance(cwd, dependencyTaskId, dependencyDocument)) {
      blockers.push(buildDependencyCloseoutBlocker(cwd, dependencyTaskId, dependencyPath, dependencyDocument));
    }
  }
  return blockers;
}

export function areTaskDependenciesSatisfied(
  task: TaskDependencyRouteSummary,
  statusById: ReadonlyMap<string, string>,
  cwd = process.cwd()
): boolean {
  return task.dependencies.every((dependencyTaskId) => {
    const status = statusById.get(dependencyTaskId);
    if (status !== 'done' && status !== 'verified') {
      return false;
    }
    const dependencyPath = taskPathFor(cwd, dependencyTaskId);
    if (!existsSync(dependencyPath)) {
      return false;
    }
    const dependencyDocument = readTaskDocument(dependencyPath);
    return Boolean(
      dependencyDocument
      && isDependencyStatusClosed(dependencyDocument.status)
      && verifyCloseoutProvenance(cwd, dependencyTaskId, dependencyDocument)
    );
  });
}
