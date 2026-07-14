import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { detectFrameworkRepoIdentity } from '../framework-development.ts';
import { resolveCandidatePlanningRoots } from '../next/planning-root-preference.ts';

const TARGET_TASK_PLAN_PREFIX = path.join('.atm', 'task-plans');
const PLANNING_FAMILY_PATTERN = /^TASK-(AAO|TEAM)(?:-|$)/i;

export interface PlanningRootAuthorshipFinding {
  readonly taskId: string;
  readonly expectedCardHint: string;
  readonly foundCardPath: string | null;
}

export interface PlanningRootAuthorshipReport {
  readonly schemaId: 'atm.planningRootAuthorship.v1';
  readonly applies: boolean;
  readonly ok: boolean;
  readonly waived: boolean;
  readonly code: 'ATM_TASKS_IMPORT_PLANNING_ROOT_REQUIRED' | null;
  readonly detail: string | null;
  readonly planPath: string;
  readonly planningRootsChecked: readonly string[];
  readonly missingTaskIds: readonly string[];
  readonly findings: readonly PlanningRootAuthorshipFinding[];
  readonly requiredCommand: string | null;
  readonly waiveCommand: string | null;
}

function normalizeRelativePosix(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function isTargetTaskPlanPath(planRelativePath: string): boolean {
  const normalized = normalizeRelativePosix(planRelativePath);
  return normalized === '.atm/task-plans'
    || normalized.startsWith('.atm/task-plans/');
}

export function isPlanningFamilyTaskId(taskId: string): boolean {
  return PLANNING_FAMILY_PATTERN.test(taskId.trim());
}

function listTaskCardCandidates(tasksDirectory: string, taskId: string): string[] {
  if (!existsSync(tasksDirectory)) return [];
  try {
    return readdirSync(tasksDirectory)
      .filter((entry) => {
        const upper = entry.toUpperCase();
        const id = taskId.toUpperCase();
        return upper.startsWith(id)
          && (entry.endsWith('.task.md') || entry.endsWith('.md'));
      })
      .map((entry) => path.join(tasksDirectory, entry));
  } catch {
    return [];
  }
}

function walkTaskDirectories(root: string, out: string[], depth = 0): void {
  if (depth > 8 || !existsSync(root)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.atm') continue;
    const absolute = path.join(root, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(absolute).isDirectory();
    } catch {
      continue;
    }
    if (!isDirectory) continue;
    if (entry === 'tasks') {
      out.push(absolute);
      continue;
    }
    walkTaskDirectories(absolute, out, depth + 1);
  }
}

export function findPlanningRootTaskCard(input: {
  readonly planningRoots: readonly string[];
  readonly taskId: string;
}): string | null {
  for (const planningRoot of input.planningRoots) {
    const taskDirs: string[] = [];
    walkTaskDirectories(planningRoot, taskDirs);
    for (const tasksDirectory of taskDirs) {
      const matches = listTaskCardCandidates(tasksDirectory, input.taskId);
      if (matches.length > 0) return matches[0]!;
    }
  }
  return null;
}

export function inspectPlanningRootAuthorship(input: {
  readonly cwd: string;
  readonly planAbsolute: string;
  readonly planRelativePath: string;
  readonly taskIds: readonly string[];
  readonly waivePlanningRoot?: boolean;
  readonly isFrameworkRepo?: boolean;
  readonly planningRoots?: readonly string[];
}): PlanningRootAuthorshipReport {
  const planRelativePath = normalizeRelativePosix(input.planRelativePath);
  const isFrameworkRepo = input.isFrameworkRepo
    ?? detectFrameworkRepoIdentity(input.cwd).isFrameworkRepo;
  const familyTaskIds = uniqueSorted(input.taskIds.filter(isPlanningFamilyTaskId));
  const applies = Boolean(
    isFrameworkRepo
    && isTargetTaskPlanPath(planRelativePath)
    && familyTaskIds.length > 0
  );
  const planningRoots = input.planningRoots
    ?? resolveCandidatePlanningRoots(input.cwd).roots;
  const findings: PlanningRootAuthorshipFinding[] = familyTaskIds.map((taskId) => {
    const foundCardPath = findPlanningRootTaskCard({ planningRoots, taskId });
    return {
      taskId,
      expectedCardHint: `docs/ai_atomic_framework/**/tasks/${taskId}-*.task.md`,
      foundCardPath
    };
  });
  const missingTaskIds = findings
    .filter((entry) => !entry.foundCardPath)
    .map((entry) => entry.taskId);
  const waived = input.waivePlanningRoot === true;
  if (!applies) {
    return {
      schemaId: 'atm.planningRootAuthorship.v1',
      applies: false,
      ok: true,
      waived: false,
      code: null,
      detail: null,
      planPath: planRelativePath,
      planningRootsChecked: planningRoots,
      missingTaskIds: [],
      findings: [],
      requiredCommand: null,
      waiveCommand: null
    };
  }
  if (missingTaskIds.length === 0 || waived) {
    return {
      schemaId: 'atm.planningRootAuthorship.v1',
      applies: true,
      ok: true,
      waived,
      code: null,
      detail: waived
        ? `Planning-root authorship waived for ${familyTaskIds.join(', ')} while importing ${planRelativePath}.`
        : `Planning-root authorship confirmed for ${familyTaskIds.join(', ')}.`,
      planPath: planRelativePath,
      planningRootsChecked: planningRoots,
      missingTaskIds: waived ? missingTaskIds : [],
      findings,
      requiredCommand: null,
      waiveCommand: null
    };
  }
  const exampleTaskId = missingTaskIds[0]!;
  const requiredCommand = `Write the formal planning card under the canonical planning root (docs/ai_atomic_framework/**/tasks/${exampleTaskId}-*.task.md), update that family's roster README, then re-run: node atm.mjs tasks import --from <planning-card-path> --write --json`;
  return {
    schemaId: 'atm.planningRootAuthorship.v1',
    applies: true,
    ok: false,
    waived: false,
    code: 'ATM_TASKS_IMPORT_PLANNING_ROOT_REQUIRED',
    detail: `Framework-repo import of ${planRelativePath} is missing canonical planning-root authorship for ${missingTaskIds.join(', ')}. Author the AAO/TEAM card under docs/ai_atomic_framework/**/tasks/ in the planning repo before importing from .atm/task-plans/, or pass --waive-planning-root --reason "<why target-only is allowed>".`,
    planPath: planRelativePath,
    planningRootsChecked: planningRoots,
    missingTaskIds,
    findings,
    requiredCommand,
    waiveCommand: `node atm.mjs tasks import --from ${planRelativePath} --write --waive-planning-root --reason "<why target-only is allowed>" --json`
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
}
