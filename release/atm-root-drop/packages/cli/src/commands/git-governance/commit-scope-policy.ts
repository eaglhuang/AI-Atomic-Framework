import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type TaskClaimIntent = 'write' | 'closeout-only';

export type PhysicalLineBudgetContext = {
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly gate?: string | null;
};

export type PhysicalLineBudgetReport = {
  readonly ok: boolean;
  readonly mode: 'touched';
  readonly scannedFiles: number;
  readonly maxLines: number;
  readonly softLines: number;
  readonly hardViolationCount: number;
  readonly softWarningCount: number;
  readonly topFile: { readonly file: string; readonly lines: number } | null;
  readonly hardViolations: readonly { readonly file: string; readonly lines: number }[];
  readonly softWarnings: readonly { readonly file: string; readonly lines: number }[];
  readonly context: PhysicalLineBudgetContext;
  readonly reproduceCommand: string;
};

const DEFAULT_PHYSICAL_LINE_BUDGET_MAX = 600;
const DEFAULT_PHYSICAL_LINE_BUDGET_SOFT = 500;
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const excludedSegments = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.next']);
const excludedPrefixes = ['release/atm-root-drop/', 'release/atm-onefile/'];

export function inspectTouchedPhysicalLineBudget(
  cwd: string,
  touchedFiles: readonly string[],
  context: PhysicalLineBudgetContext = {}
): PhysicalLineBudgetReport {
  const files = uniqueSorted(touchedFiles)
    .filter((file) => isPhysicalLineBudgetSourceFile(file))
    .filter((file) => !shouldSkipPhysicalLineBudgetPath(file))
    .filter((file) => existsSync(path.join(cwd, file)));
  const maxLines = readConfiguredPhysicalLineBudget(cwd, 'maxLines', DEFAULT_PHYSICAL_LINE_BUDGET_MAX);
  const softLines = readConfiguredPhysicalLineBudget(cwd, 'softLines', DEFAULT_PHYSICAL_LINE_BUDGET_SOFT);
  const rows = files.map((file) => ({ file, lines: countCandidatePhysicalLines(cwd, file) }))
    .sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));
  const hardViolations = rows.filter((entry) => entry.lines > maxLines);
  const softWarnings = rows.filter((entry) => entry.lines > softLines && entry.lines <= maxLines);
  return {
    ok: hardViolations.length === 0,
    mode: 'touched',
    scannedFiles: rows.length,
    maxLines,
    softLines,
    hardViolationCount: hardViolations.length,
    softWarningCount: softWarnings.length,
    topFile: rows[0] ?? null,
    hardViolations,
    softWarnings,
    context: {
      taskId: context.taskId ?? null,
      actorId: context.actorId ?? null,
      gate: context.gate ?? null
    },
    reproduceCommand: buildTouchedPhysicalLineBudgetReproduceCommand(files, context)
  };
}

function isPhysicalLineBudgetSourceFile(filePath: string): boolean {
  return sourceExtensions.has(path.extname(filePath).toLowerCase());
}

function shouldSkipPhysicalLineBudgetPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  if (excludedPrefixes.some((prefix) => normalized.startsWith(prefix))) return true;
  return normalized.split('/').some((segment) => excludedSegments.has(segment));
}

function readConfiguredPhysicalLineBudget(cwd: string, key: 'maxLines' | 'softLines', fallback: number): number {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { governance?: { physicalLineBudget?: Record<string, unknown> } };
    const value = Number(parsed.governance?.physicalLineBudget?.[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function countPhysicalLines(filePath: string): number {
  const content = readFileSync(filePath, 'utf8');
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length - (content.endsWith('\n') ? 1 : 0);
}

function countCandidatePhysicalLines(cwd: string, file: string): number {
  const stagedLines = countStagedDiffPhysicalLines(cwd, file);
  if (stagedLines !== null) return stagedLines;
  return countPhysicalLines(path.join(cwd, file));
}

function countStagedDiffPhysicalLines(cwd: string, file: string): number | null {
  try {
    const output = execFileSync('git', ['diff', '--cached', '--numstat', '--', file], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!output) return null;
    const [addedRaw, deletedRaw] = output.split(/\s+/);
    const added = Number.parseInt(addedRaw ?? '', 10);
    const deleted = Number.parseInt(deletedRaw ?? '', 10);
    if (!Number.isFinite(added) || !Number.isFinite(deleted)) return null;
    return added + deleted;
  } catch {
    return null;
  }
}

function buildTouchedPhysicalLineBudgetReproduceCommand(files: readonly string[], context: PhysicalLineBudgetContext): string {
  const parts = ['node --strip-types scripts/validate-physical-line-budget.ts', '--json'];
  if (files.length > 0) parts.push('--touched', files.join(','));
  if (context.taskId) parts.push('--task', context.taskId);
  if (context.actorId) parts.push('--actor', context.actorId);
  if (context.gate) parts.push('--gate', context.gate);
  return parts.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeRelativePath).filter(Boolean))].sort();
}

export function pathMatchesTaskScope(filePath: string, scope: string): boolean {
  const file = normalizeRelativePath(filePath).toLowerCase();
  const candidate = normalizeRelativePath(scope).toLowerCase();
  if (!candidate) return false;
  if (candidate.includes('*')) {
    // `dir/**/*.ts` must match `dir/foo.ts` (zero intermediate directories).
    // Treat `**/` as an optional path prefix before single-segment wildcards.
    const escaped = candidate
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '__ATM_GLOBSTAR_SLASH__')
      .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__ATM_GLOBSTAR_SLASH__/g, '(?:.*/)?')
      .replace(/__ATM_DOUBLE_STAR__/g, '.*');
    return new RegExp(`^${escaped}$`).test(file);
  }
  return file === candidate || file.startsWith(`${candidate.replace(/\/$/, '')}/`);
}

export function extractGovernanceTaskIdFromPath(filePath: string): string | null {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized.startsWith('.atm/history/')) return null;
  const tasksMatch = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
  if (tasksMatch) return tasksMatch[1].toUpperCase();
  const evidenceMatch = normalized.match(/^\.atm\/history\/evidence\/([^/.]+)(?:\.[^/]+)?$/i);
  if (evidenceMatch) return evidenceMatch[1].toUpperCase();
  const eventMatch = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
  if (eventMatch) return eventMatch[1].toUpperCase();
  return null;
}

export function isProtectedStagedGovernanceOwnershipPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  if (/^\.atm\/history\/evidence\/[^/]+\.bundle-manifest\.json$/.test(normalized)) {
    return false;
  }
  return normalized.startsWith('.atm/history/tasks/')
    || normalized.startsWith('.atm/history/task-events/')
    || normalized.startsWith('.atm/history/evidence/');
}

export function normalizeTaskClaimIntent(value: unknown): TaskClaimIntent {
  if (typeof value !== 'string') return 'write';
  const normalized = value.trim().toLowerCase();
  return normalized === 'closeout-only' || normalized === 'no-more-mutation' ? 'closeout-only' : 'write';
}
