import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseJsonText, relativePathFrom } from './shared.ts';
import {
  PLANNING_ROOT_RELATIVE_SUFFIX,
  resolveCandidatePlanningRoots,
  type PlanningRootResolution
} from './next/planning-root-preference.ts';

export const PLANNING_REPO_ROOT_ENV = 'ATM_PLANNING_REPO_ROOT';

export interface PlanningRepoRootConfig {
  readonly envRoot: string | null;
  readonly configRoots: readonly string[];
  readonly resolvedConfigRoots: readonly string[];
  readonly candidateResolution: PlanningRootResolution;
  readonly effectiveRoots: readonly string[];
}

export interface StoredPlanningPathResolution {
  readonly storedPath: string;
  readonly absolutePath: string;
  readonly planningRoot: string | null;
  readonly planningRelativePath: string | null;
  readonly isExternalPlanning: boolean;
}

export interface PlanningRootMissingDiagnostic {
  readonly code: 'ATM_PLANNING_ROOT_MISSING';
  readonly detail: string;
  readonly suggestedEnv: string;
  readonly suggestedConfig: Record<string, unknown>;
  readonly requiredCommand: string;
}

const PLANNING_ROOT_DOC_PREFIX = `${PLANNING_ROOT_RELATIVE_SUFFIX.replace(/\\/g, '/')}/`;

export function isPlanningRootDocStoredPath(storedPath: string): boolean {
  const normalized = normalizeStoredPlanningPath(storedPath);
  return normalized === PLANNING_ROOT_RELATIVE_SUFFIX.replace(/\\/g, '/')
    || normalized.startsWith(PLANNING_ROOT_DOC_PREFIX);
}

function toPlanningRootRelativeFromDocPath(storedPath: string): string | null {
  const normalized = normalizeStoredPlanningPath(storedPath);
  if (!isPlanningRootDocStoredPath(normalized)) return null;
  if (normalized === PLANNING_ROOT_RELATIVE_SUFFIX.replace(/\\/g, '/')) return '';
  return normalized.slice(PLANNING_ROOT_DOC_PREFIX.length);
}

const TARGET_REPO_ROOT_PREFIXES = [
  '.atm/',
  '.github/',
  '.claude/',
  '.cursor/',
  '.gemini/',
  'atomic_workbench/',
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
  'tests/'
] as const;

export function looksLikePlanningRootRelativePath(storedPath: string): boolean {
  const normalized = normalizeStoredPlanningPath(storedPath);
  if (!normalized || normalized.startsWith('../')) return false;
  if (TARGET_REPO_ROOT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  if (normalized.startsWith('docs/')) return false;
  return normalized.includes('/');
}

export function readPlanningRootEnv(): string | null {
  const raw = process.env[PLANNING_REPO_ROOT_ENV]?.trim();
  if (!raw) return null;
  return path.resolve(raw);
}

export function readConfiguredPlanningRoots(cwd: string): readonly string[] {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return [];
  try {
    const parsed = parseJsonText(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const taskLedger = parsed.taskLedger && typeof parsed.taskLedger === 'object' && !Array.isArray(parsed.taskLedger)
      ? parsed.taskLedger as Record<string, unknown>
      : {};
    return readStringArray(
      taskLedger.planningRoots
      ?? taskLedger.externalPlanningRoots
      ?? taskLedger.planningRepoRoot
      ?? taskLedger.planning_repo_root
    );
  } catch {
    return [];
  }
}

export function resolvePlanningRepoRootConfig(cwd: string): PlanningRepoRootConfig {
  const envRoot = readPlanningRootEnv();
  const configRoots = readConfiguredPlanningRoots(cwd);
  const resolvedConfigRoots = uniqueSorted([
    ...(envRoot && existsSync(envRoot) ? [envRoot] : []),
    ...configRoots.map((entry) => path.isAbsolute(entry) ? entry : path.resolve(cwd, entry))
      .filter((entry) => existsSync(entry))
  ]);
  const candidateResolution = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: configRoots
  });
  const effectiveRoots = uniqueSorted([
    ...resolvedConfigRoots,
    ...candidateResolution.roots
  ]);
  return {
    envRoot,
    configRoots,
    resolvedConfigRoots,
    candidateResolution,
    effectiveRoots
  };
}

export function toStoredPlanningPath(cwd: string, absolutePath: string): string {
  const normalizedAbsolute = path.resolve(absolutePath);
  const config = resolvePlanningRepoRootConfig(cwd);
  for (const planningRoot of config.effectiveRoots) {
    const resolvedRoot = path.resolve(planningRoot);
    if (normalizedAbsolute === resolvedRoot || normalizedAbsolute.startsWith(`${resolvedRoot}${path.sep}`)) {
      return normalizeStoredPlanningPath(path.relative(resolvedRoot, normalizedAbsolute));
    }
  }
  return normalizeStoredPlanningPath(relativePathFrom(cwd, normalizedAbsolute));
}

export function resolveStoredPlanningPath(cwd: string, storedPath: string): StoredPlanningPathResolution {
  const normalizedStored = normalizeStoredPlanningPath(storedPath);
  if (!normalizedStored) {
    return {
      storedPath: normalizedStored,
      absolutePath: cwd,
      planningRoot: null,
      planningRelativePath: null,
      isExternalPlanning: false
    };
  }

  const config = resolvePlanningRepoRootConfig(cwd);
  const legacyExternal = normalizedStored.startsWith('../');
  const docRelative = toPlanningRootRelativeFromDocPath(normalizedStored);
  let absolutePath = path.isAbsolute(normalizedStored)
    ? path.resolve(normalizedStored)
    : path.resolve(cwd, normalizedStored);

  if (docRelative !== null) {
    for (const planningRoot of config.effectiveRoots) {
      const candidate = docRelative
        ? path.resolve(planningRoot, docRelative)
        : path.resolve(planningRoot);
      absolutePath = candidate;
      return {
        storedPath: normalizedStored,
        absolutePath,
        planningRoot: path.resolve(planningRoot),
        planningRelativePath: normalizeStoredPlanningPath(docRelative || '.'),
        isExternalPlanning: true
      };
    }
    return {
      storedPath: normalizedStored,
      absolutePath: path.resolve(cwd, normalizedStored),
      planningRoot: null,
      planningRelativePath: docRelative,
      isExternalPlanning: true
    };
  }

  if (!legacyExternal && !path.isAbsolute(normalizedStored)) {
    for (const planningRoot of config.effectiveRoots) {
      const candidate = path.resolve(planningRoot, normalizedStored);
      if (existsSync(candidate)) {
        absolutePath = candidate;
        break;
      }
    }
  }

  for (const planningRoot of config.effectiveRoots) {
    const resolvedRoot = path.resolve(planningRoot);
    if (absolutePath === resolvedRoot || absolutePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      return {
        storedPath: normalizedStored,
        absolutePath,
        planningRoot: resolvedRoot,
        planningRelativePath: normalizeStoredPlanningPath(path.relative(resolvedRoot, absolutePath)),
        isExternalPlanning: !isPathUnderDirectory(cwd, absolutePath)
      };
    }
  }

  return {
    storedPath: normalizedStored,
    absolutePath,
    planningRoot: null,
    planningRelativePath: null,
    isExternalPlanning: legacyExternal || looksLikeLegacyExternalPlanningStoredPath(normalizedStored)
  };
}

export function isExternalPlanningStoredPath(cwd: string, storedPath: string): boolean {
  return resolveStoredPlanningPath(cwd, storedPath).isExternalPlanning;
}

export function normalizeStoredPlanningPathForIdentity(cwd: string, storedPath: string): string {
  const resolved = resolveStoredPlanningPath(cwd, storedPath);
  if (resolved.planningRelativePath) return resolved.planningRelativePath;
  return resolved.storedPath;
}

export function resolvePlanningPathFromStored(cwd: string, storedPath: string | null): {
  readonly repoRoot: string | null;
  readonly relativePath: string | null;
  readonly reason: string | null;
} {
  if (!storedPath) {
    return { repoRoot: null, relativePath: null, reason: 'planning mirror path is unavailable' };
  }
  const resolved = resolveStoredPlanningPath(cwd, storedPath);
  const repoRoot = findGitRoot(resolved.absolutePath);
  if (!repoRoot) {
    return {
      repoRoot: null,
      relativePath: null,
      reason: `no git repository found for planning path ${storedPath}`
    };
  }
  return {
    repoRoot,
    relativePath: normalizeStoredPlanningPath(path.relative(repoRoot, resolved.absolutePath)),
    reason: null
  };
}

export function resolvePlanAbsoluteFromStored(cwd: string, storedPath: string): string {
  return resolveStoredPlanningPath(cwd, storedPath).absolutePath;
}

export function buildPlanningRootMissingDiagnostic(cwd: string): PlanningRootMissingDiagnostic {
  const exampleRoot = path.join('..', 'planning-repo', PLANNING_ROOT_RELATIVE_SUFFIX.replace(/\\/g, '/'));
  const suggestedConfig = {
    taskLedger: {
      planningRoots: [exampleRoot]
    }
  };
  const suggestedEnv = `${PLANNING_REPO_ROOT_ENV}=${path.join('..', 'planning-repo', PLANNING_ROOT_RELATIVE_SUFFIX.replace(/\\/g, '/'))}`;
  return {
    code: 'ATM_PLANNING_ROOT_MISSING',
    detail: 'Cross-repo planning is configured, but ATM could not resolve a planning root from environment or .atm/config.json.',
    suggestedEnv,
    suggestedConfig,
    requiredCommand: `Set ${PLANNING_REPO_ROOT_ENV} or add taskLedger.planningRoots in .atm/config.json, then retry.`
  };
}

export function shouldReportPlanningRootMissing(input: {
  readonly cwd: string;
  readonly taskScopeMentioned: boolean;
  readonly mentionedPlanPaths: readonly string[];
  readonly userPrompt: string | null;
  readonly matchedTaskCount: number;
}): PlanningRootMissingDiagnostic | null {
  if (!input.taskScopeMentioned || input.matchedTaskCount > 0) return null;
  const mentionsExternalPlanning = input.mentionedPlanPaths.some((entry) => entry.includes('ai_atomic_framework'))
    || Boolean(input.userPrompt && /ai[-_\s]?atomic[-_\s]?framework|planning repo|planning root/i.test(input.userPrompt));
  if (!mentionsExternalPlanning) return null;
  const config = resolvePlanningRepoRootConfig(input.cwd);
  if (config.resolvedConfigRoots.length > 0) return null;
  return buildPlanningRootMissingDiagnostic(input.cwd);
}

function looksLikeLegacyExternalPlanningStoredPath(storedPath: string): boolean {
  if (storedPath.startsWith('../')) return true;
  if (isPlanningRootDocStoredPath(storedPath)) return true;
  if (TARGET_REPO_ROOT_PREFIXES.some((prefix) => storedPath.startsWith(prefix))) return false;
  return looksLikePlanningRootRelativePath(storedPath);
}

function isPathUnderDirectory(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function findGitRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  const leaf = path.basename(current);
  const startIsFile = existsSync(current) && !current.endsWith(path.sep) && leaf.includes('.');
  if (startIsFile) current = path.dirname(current);
  while (true) {
    if (existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function normalizeStoredPlanningPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function readStringArray(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
