import { existsSync, readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';

export const PLANNING_ROOT_RELATIVE_SUFFIX = path.join('docs', 'ai_atomic_framework');

export interface PlanningRootWarning {
  readonly code: 'ATM_PLANNING_ROOT_AMBIGUOUS';
  readonly detail: string;
  readonly siblingRepoDirs: readonly string[];
}

export interface PlanningRootResolution {
  readonly roots: readonly string[];
  readonly excludedDerivativeRoots: readonly string[];
  readonly ambiguousSiblingGroups: readonly (readonly string[])[];
  readonly warnings: readonly PlanningRootWarning[];
}

export function isDerivativeSiblingRepoName(canonicalName: string, candidateName: string): boolean {
  if (canonicalName === candidateName) return false;
  if (candidateName.length <= canonicalName.length) return false;
  return candidateName.startsWith(`${canonicalName}-`);
}

export function repoDirFromPlanningRoot(planningRoot: string): string | null {
  const normalized = planningRoot.replace(/\\/g, '/');
  const suffix = `/${PLANNING_ROOT_RELATIVE_SUFFIX.replace(/\\/g, '/')}`;
  if (!normalized.endsWith(suffix)) return null;
  return path.dirname(path.dirname(planningRoot));
}

export function repoDirNameFromPlanningRoot(planningRoot: string): string | null {
  const repoDir = repoDirFromPlanningRoot(planningRoot);
  return repoDir ? path.basename(repoDir) : null;
}

export function applyCanonicalSiblingPreference(
  planningRoots: readonly string[],
  parentDir: string
): PlanningRootResolution {
  const siblingRoots = planningRoots.filter((root) => {
    const repoDir = repoDirFromPlanningRoot(root);
    return repoDir !== null && path.resolve(path.dirname(repoDir)) === path.resolve(parentDir);
  });
  const siblingNames = uniqueSorted(
    siblingRoots
      .map((root) => repoDirNameFromPlanningRoot(root))
      .filter((entry): entry is string => Boolean(entry))
  );

  const excluded = new Set<string>();
  for (const candidateName of siblingNames) {
    for (const canonicalName of siblingNames) {
      if (!isDerivativeSiblingRepoName(canonicalName, candidateName)) continue;
      const candidateRoot = siblingRoots.find((root) => repoDirNameFromPlanningRoot(root) === candidateName);
      if (candidateRoot) excluded.add(path.resolve(candidateRoot));
    }
  }

  const filtered = planningRoots.filter((root) => !excluded.has(path.resolve(root)));
  const remainingSiblingNames = filtered
    .filter((root) => {
      const repoDir = repoDirFromPlanningRoot(root);
      return repoDir !== null && path.resolve(path.dirname(repoDir)) === path.resolve(parentDir);
    })
    .map((root) => repoDirNameFromPlanningRoot(root))
    .filter((entry): entry is string => Boolean(entry));

  const ambiguousSiblingGroups: string[][] = [];
  const warnings: PlanningRootWarning[] = [];
  const derivativeOnlyFamilies = new Map<string, string[]>();
  for (const name of remainingSiblingNames) {
    const dashIndex = name.indexOf('-');
    if (dashIndex <= 0) continue;
    const base = name.slice(0, dashIndex);
    if (remainingSiblingNames.includes(base)) continue;
    derivativeOnlyFamilies.set(base, [...(derivativeOnlyFamilies.get(base) ?? []), name]);
  }
  for (const [base, members] of derivativeOnlyFamilies.entries()) {
    if (members.length < 2) continue;
    ambiguousSiblingGroups.push(uniqueSorted(members));
    warnings.push({
      code: 'ATM_PLANNING_ROOT_AMBIGUOUS',
      detail: `Multiple sibling planning repos share prefix "${base}" without a canonical "${base}" directory.`,
      siblingRepoDirs: uniqueSorted(members)
    });
  }

  return {
    roots: filtered,
    excludedDerivativeRoots: Array.from(excluded).sort((left, right) => left.localeCompare(right)),
    ambiguousSiblingGroups,
    warnings
  };
}

export function resolveCandidatePlanningRoots(
  cwd: string,
  options?: {
    readonly configuredRoots?: readonly string[];
    readonly readDir?: (directoryPath: string) => readonly Dirent[];
    readonly exists?: (filePath: string) => boolean;
  }
): PlanningRootResolution {
  const readDir = options?.readDir ?? safeReadDir;
  const exists = options?.exists ?? existsSync;
  const roots = new Set<string>();

  for (const configuredRoot of options?.configuredRoots ?? []) {
    roots.add(path.isAbsolute(configuredRoot) ? configuredRoot : path.resolve(cwd, configuredRoot));
  }
  roots.add(path.join(cwd, PLANNING_ROOT_RELATIVE_SUFFIX));

  const parent = path.dirname(path.resolve(cwd));
  for (const entry of readDir(parent)) {
    if (!entry.isDirectory()) continue;
    roots.add(path.join(parent, entry.name, PLANNING_ROOT_RELATIVE_SUFFIX));
  }

  const resolved = Array.from(roots)
    .map((entry) => path.resolve(entry))
    .filter((entry) => exists(entry))
    .sort((left, right) => left.localeCompare(right));

  return applyCanonicalSiblingPreference(resolved, parent);
}

export function listCandidatePlanningRoots(cwd: string): readonly string[] {
  return resolveCandidatePlanningRoots(cwd).roots;
}

export function isExcludedDerivativePlanningRoot(
  taskPath: string,
  cwd: string,
  resolution: PlanningRootResolution
): boolean {
  const absoluteTaskPath = path.isAbsolute(taskPath) ? taskPath : path.resolve(cwd, taskPath);
  return resolution.excludedDerivativeRoots.some((root) => {
    const repoDir = repoDirFromPlanningRoot(root);
    return repoDir ? absoluteTaskPath.startsWith(`${repoDir}${path.sep}`) : false;
  });
}

export function isCanonicalPreferredPlanningRoot(taskPath: string, cwd: string): boolean {
  const absoluteTaskPath = path.isAbsolute(taskPath) ? path.resolve(taskPath) : path.resolve(cwd, taskPath);
  const resolution = resolveCandidatePlanningRoots(cwd);
  if (isExcludedDerivativePlanningRoot(taskPath, cwd, resolution)) return false;
  return resolution.roots.some((root) => absoluteTaskPath.startsWith(`${root}${path.sep}`) || absoluteTaskPath.startsWith(`${root.replace(/\\/g, '/')}/`));
}

function safeReadDir(directoryPath: string): readonly Dirent[] {
  try {
    return readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
