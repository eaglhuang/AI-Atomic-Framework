import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isPlanningRootDocStoredPath, looksLikePlanningRootRelativePath } from '../planning-repo-root.ts';
import type { TaskDirectionLock, TaskDirectionTask, TaskQueueRecord } from '../task-direction.ts';

export function sanitizeTaskDirectionAllowedFiles(values: readonly string[]): readonly string[] {
  return uniqueSorted(values
    .map(normalizeRelativePath)
    .filter(isTaskDirectionPathCandidate));
}

export function isTaskDirectionPathCandidate(value: string): boolean {
  const normalized = normalizeRelativePath(value);
  if (!normalized || normalized.length > 260 || /[\r\n]/.test(normalized)) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (/\s\/|\/\s/.test(normalized)) return false;
  if (normalized === '.gitattributes' || normalized === '.gitignore') return true;

  const knownRoots = [
    '.atm/',
    '.github/',
    '.claude/',
    '.cursor/',
    '.gemini/',
    'atomic_workbench/',
    'docs/',
    'examples/',
    'fixtures/',
    'integrations/',
    'packages/',
    'pipelines/',
    'release/',
    'schemas/',
    'scripts/',
    'specs/',
    'templates/',
    'tests/',
    '文件/'
  ];
  if (knownRoots.some((root) => normalized === root.slice(0, -1) || normalized.startsWith(root))) return true;
  if (normalized.includes('*') && normalized.includes('/')) return true;

  const lastSegment = normalized.split('/').pop() ?? normalized;
  return /^[^<>:"|?*]+\.[A-Za-z0-9][A-Za-z0-9._-]{0,12}$/.test(lastSegment);
}

export function isPlanningMirrorPath(filePath: string, planningMirrorPaths: readonly string[]): boolean {
  const normalizedFile = normalizeRelativePath(filePath).toLowerCase();
  return planningMirrorPaths.some((candidate) => matchesPlanningMirrorPath(normalizedFile, normalizeRelativePath(candidate).toLowerCase()));
}

export function listTaskQueues(cwd: string): readonly TaskQueueRecord[] {
  const root = path.join(cwd, '.atm', 'runtime', 'task-queues');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry) => {
      const record = readTaskQueue(cwd, entry.replace(/\.json$/, ''));
      return record ? [record] : [];
    });
}

export function readTaskQueue(cwd: string, queueId: string): TaskQueueRecord | null {
  const queuePath = path.join(cwd, '.atm', 'runtime', 'task-queues', `${queueId}.json`);
  if (!existsSync(queuePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(queuePath, 'utf8')) as TaskQueueRecord;
    return parsed.schemaId === 'atm.taskQueue.v1'
      ? {
        ...parsed,
        batchId: parsed.batchId ?? null,
        scopeKey: parsed.scopeKey ?? deriveQueueScopeKey(parsed.tasks ?? [], parsed.taskIds ?? [])
      }
      : null;
  } catch {
    return null;
  }
}

export function writeTaskQueue(cwd: string, record: TaskQueueRecord) {
  const queuePath = path.join(cwd, '.atm', 'runtime', 'task-queues', `${record.queueId}.json`);
  mkdirSync(path.dirname(queuePath), { recursive: true });
  writeJson(queuePath, record);
}

export function buildQueueId(sourcePrompt: string, taskIds: readonly string[]) {
  return `queue-${sha256([sourcePrompt.trim(), ...taskIds].join('\n')).slice(0, 16)}`;
}

export function deriveQueueScopeKey(tasks: readonly TaskDirectionTask[], taskIds: readonly string[]) {
  const idRoots = uniqueSorted(taskIds.map((taskId) => {
    const match = taskId.match(/^(.+?)-\d{2,}(?:-.+)?$/);
    return match?.[1] ?? '';
  }).filter(Boolean));
  if (idRoots.length === 1) return idRoots[0] ?? null;
  const planPaths = uniqueSorted(tasks.map((task) => task.sourcePlanPath).filter((entry): entry is string => Boolean(entry)));
  if (planPaths.length === 1) return `plan-${sha256(planPaths[0] ?? '').slice(0, 12)}`;
  if (taskIds.length > 0) return `tasks-${sha256(taskIds.join('\n')).slice(0, 12)}`;
  return null;
}

export function resolveQueueSourcePlan(tasks: readonly TaskDirectionTask[]) {
  const paths = uniqueSorted(tasks.map((task) => task.sourcePlanPath).filter((entry): entry is string => Boolean(entry)));
  return paths.length === 1 ? paths[0] : null;
}

export function resolveQueueTargetRepo(tasks: readonly TaskDirectionTask[]) {
  const targets = uniqueSorted(tasks.map((task) => task.targetRepo).filter((entry): entry is string => Boolean(entry)));
  return targets.length === 1 ? targets[0] : null;
}

export function isTaskDirectionLock(value: unknown): value is TaskDirectionLock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaId === 'atm.taskDirectionLock.v1'
    && typeof record.taskId === 'string'
    && typeof record.actorId === 'string'
    && record.status === 'active';
}

export function dedupeDirectionLocks(locks: readonly TaskDirectionLock[]) {
  const seen = new Set<string>();
  const output: TaskDirectionLock[] = [];
  for (const lock of locks) {
    const key = `${lock.taskId}:${lock.actorId}:${lock.queueId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(lock);
  }
  return output;
}

export function readGovernanceDirectionLockForTask(cwd: string, taskId: string): TaskDirectionLock | null {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  if (!existsSync(lockPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const released = parsed.released === true || parsed.status === 'released';
    if (released) return null;
    const embedded = parsed.taskDirectionLock;
    return isTaskDirectionLock(embedded) ? embedded : null;
  } catch {
    return null;
  }
}

export function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function isExternalPlanningPath(value: string) {
  const normalized = normalizeRelativePath(value);
  return normalized.startsWith('../')
    || isPlanningRootDocStoredPath(normalized)
    || looksLikePlanningRootRelativePath(normalized);
}

export function derivePlanningMirrorGuardPaths(value: string): readonly string[] {
  const normalized = normalizeRelativePath(value);
  const docsIndex = normalized.toLowerCase().indexOf('docs/');
  if (docsIndex < 0 || docsIndex === 0) return [];
  const mirrorPath = normalized.slice(docsIndex);
  if (!isTaskDirectionPathCandidate(mirrorPath)) return [];
  const guards = new Set<string>([mirrorPath]);
  let current = path.posix.dirname(mirrorPath);
  while (current && current !== '.' && current !== 'docs') {
    guards.add(`${current}/`);
    current = path.posix.dirname(current);
  }
  return [...guards].sort((left, right) => left.localeCompare(right));
}

export function matchesPlanningMirrorPath(filePath: string, mirrorPath: string) {
  if (!mirrorPath) return false;
  if (mirrorPath.endsWith('/')) return filePath === mirrorPath.slice(0, -1) || filePath.startsWith(mirrorPath);
  if (filePath === mirrorPath) return true;
  return filePath.startsWith(`${mirrorPath}/`);
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.map(normalizeRelativePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function uniqueInOrder(values: readonly string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map(normalizeRelativePath).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}
