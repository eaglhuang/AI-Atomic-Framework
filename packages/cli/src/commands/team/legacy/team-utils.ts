
import path from 'node:path';
import { validateStrictPathHeuristic } from '../../tasks/task-import-validators.ts';
import { normalizeRepoAbsoluteLeasePath, normalizeTeamLeasePath, normalizeTaskWriteScope } from './permission-lease-policy.ts';
export function summarizeTask(taskId: string, task: Record<string, unknown> | null | undefined) {
  return {
    taskId,
    title: (task as { title?: unknown })?.title ?? (task as { workItemId?: unknown })?.workItemId ?? taskId,
    status: (task as { status?: unknown })?.status ?? null,
    targetRepo: (task as { targetRepo?: unknown })?.targetRepo ?? null,
    sourcePlanPath: (task as { source?: { planPath?: unknown } })?.source?.planPath ?? (task as { sourcePlanPath?: unknown })?.sourcePlanPath ?? null
  };
}

export function readOptionValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}
export function deriveWritePaths(task: Record<string, unknown> | null | undefined, repoRoot?: string) {
  return deriveTeamWriteScope(task, repoRoot).writePaths;
}

export function deriveTeamWriteScope(task: Record<string, unknown> | null | undefined, repoRoot?: string) {
  const explicitAllowed = normalizeTaskPathArray((task as { targetAllowedFiles?: unknown })?.targetAllowedFiles, repoRoot);
  if (explicitAllowed.length > 0) {
    return {
      writePaths: normalizeTaskWriteScope(explicitAllowed, repoRoot),
      planningReadOnlyPaths: [] as string[],
      allowEmptyWriteScope: false
    };
  }

  const rawCandidates = [
    ...normalizeStringArray((task as { deliverables?: unknown })?.deliverables),
    ...normalizeStringArray((task as { scopePaths?: unknown })?.scopePaths)
  ];
  const candidates = normalizeTargetWritePathArray(rawCandidates, repoRoot);
  const planningReadOnlyPaths = collectPlanningReadOnlyPaths(task, repoRoot, rawCandidates);
  const writePaths = uniqueStrings(candidates.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter((normalized) => {
    return normalized && !normalized.startsWith('.atm/runtime/') && !normalized.startsWith('.atm/history/');
  }));
  return {
    writePaths,
    planningReadOnlyPaths,
    allowEmptyWriteScope: writePaths.length === 0 && planningReadOnlyPaths.length > 0
  };
}

function collectPlanningReadOnlyPaths(task: Record<string, unknown> | null | undefined, repoRoot: string | undefined, rawCandidates: string[]) {
  const planningRepo = String((task as { planningRepo?: unknown } | null | undefined)?.planningRepo ?? '').trim();
  if (!planningRepo) return [];
  const planningRoot = path.isAbsolute(planningRepo)
    ? path.resolve(planningRepo)
    : (repoRoot ? path.resolve(repoRoot, planningRepo) : '');
  if (!planningRoot) return [];
  return uniqueStrings(rawCandidates.map((entry) => normalizeAbsolutePathUnderRoot(entry, planningRoot)).filter(Boolean));
}

function normalizeAbsolutePathUnderRoot(rawPath: string, rootPath: string) {
  const raw = String(rawPath).trim();
  if (!raw || !path.isAbsolute(raw)) return '';
  const candidate = path.resolve(raw);
  const relative = path.relative(path.resolve(rootPath), candidate);
  if (!relative || relative === '') return '';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return '';
  return relative.replace(/\\/g, '/');
}

export function normalizeTargetWritePathArray(paths: string[], repoRoot?: string) {
  return paths
    .map((entry) => normalizeTargetWritePath(entry, repoRoot))
    .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null);
}

function normalizeTargetWritePath(rawPath: string, repoRoot?: string) {
  const raw = String(rawPath).trim();
  if (!raw) return '';
  const normalizedRaw = raw.replace(/\\/g, '/');
  if ((normalizedRaw.startsWith('/') || /^[A-Za-z]:\//.test(normalizedRaw)) && normalizeRepoAbsoluteLeasePath(raw, repoRoot) === null) {
    return '';
  }
  return normalizeTeamLeasePath(raw, repoRoot);
}

export function collectTaskPathHints(task: Record<string, unknown> | null | undefined) {
  return uniqueStrings([
    ...normalizeTaskPathArray((task as { targetAllowedFiles?: unknown })?.targetAllowedFiles),
    ...normalizeTaskPathArray((task as { deliverables?: unknown })?.deliverables),
    ...normalizeTaskPathArray((task as { scopePaths?: unknown })?.scopePaths)
  ]);
}

export function normalizeTaskPathArray(value: unknown, repoRoot?: string) {
  return normalizeStringArray(value)
    .map((entry) => normalizeTeamLeasePath(entry, repoRoot))
    .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null);
}

export function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
