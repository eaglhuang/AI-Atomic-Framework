import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAtomizationLinePolicy } from '../packages/cli/src/commands/tasks/task-import-validators.ts';

type BudgetEntry = {
  readonly file: string;
  readonly lines: number;
};

export type PhysicalLineBudgetContext = {
  readonly taskId?: string | null;
  readonly actorId?: string | null;
  readonly gate?: string | null;
};

export type PhysicalLineBudgetReport = {
  readonly ok: boolean;
  readonly mode: 'repository' | 'touched';
  readonly scannedFiles: number;
  readonly maxLines: number;
  readonly softLines: number;
  readonly hardViolationCount: number;
  readonly softWarningCount: number;
  readonly topFile: BudgetEntry | null;
  readonly hardViolations: readonly BudgetEntry[];
  readonly softWarnings: readonly BudgetEntry[];
  readonly context: PhysicalLineBudgetContext;
  readonly reproduceCommand: string;
};

const scanRoots = ['packages', 'scripts', 'tests'] as const;
const sourceExtensions = new Set(['.ts', '.js', '.mjs', '.cjs']);
const excludedSegments = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'fixtures',
  'fixture',
  '__fixtures__',
  'generated'
]);
const excludedPrefixes = [
  'release/',
  'artifacts/',
  'atomic_workbench/evidence/',
  'atomic_workbench/atomization-coverage/dogfood-score'
];
const softLines = 500;

const args = new Set(process.argv.slice(2));
const jsonMode = args.has('--json');
const root = process.cwd();

if (isMainModule()) {
  const touched = readTouchedArg(process.argv.slice(2));
  const context = {
    taskId: readFlagValue(process.argv.slice(2), '--task'),
    actorId: readFlagValue(process.argv.slice(2), '--actor'),
    gate: readFlagValue(process.argv.slice(2), '--gate')
  };
  const report = touched.length > 0
    ? inspectTouchedPhysicalLineBudget(root, touched, context)
    : inspectRepositoryPhysicalLineBudget(root, context);
  if (jsonMode) {
    const stream = report.ok ? process.stdout : process.stderr;
    stream.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    console.log(`[physical-line-budget] ok mode=${report.mode} scanned=${report.scannedFiles} hard=0 soft=${report.softWarningCount} top=${report.topFile?.file ?? 'none'}:${report.topFile?.lines ?? 0}`);
  } else {
    console.error(`[physical-line-budget] failed mode=${report.mode} scanned=${report.scannedFiles} hard=${report.hardViolationCount} max=${report.maxLines}`);
    for (const entry of report.hardViolations) {
      console.error(`- ${entry.file}: ${entry.lines}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}

export function inspectRepositoryPhysicalLineBudget(cwd: string, context: PhysicalLineBudgetContext = {}): PhysicalLineBudgetReport {
  return inspectPhysicalLineBudget(cwd, scanSourceFiles(cwd), 'repository', context);
}

export function inspectTouchedPhysicalLineBudget(cwd: string, touchedFiles: readonly string[], context: PhysicalLineBudgetContext = {}): PhysicalLineBudgetReport {
  const files = touchedFiles
    .map((file) => normalizePath(file))
    .filter((file) => file && !shouldSkipPath(file) && sourceExtensions.has(path.extname(file)) && existsSync(path.join(cwd, file)));
  return inspectPhysicalLineBudget(cwd, files, 'touched', context);
}

export function assertTouchedPhysicalLineBudget(cwd: string, touchedFiles: readonly string[], context: PhysicalLineBudgetContext = {}): PhysicalLineBudgetReport {
  const report = inspectTouchedPhysicalLineBudget(cwd, touchedFiles, context);
  if (!report.ok) {
    const offenderList = report.hardViolations.map((entry) => `${entry.file}:${entry.lines}`).join(', ');
    const error = new Error(`Touched-file physical line budget failed (${offenderList}). Reproduce: ${report.reproduceCommand}`);
    (error as Error & { code?: string; report?: PhysicalLineBudgetReport }).code = 'ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED';
    (error as Error & { code?: string; report?: PhysicalLineBudgetReport }).report = report;
    throw error;
  }
  return report;
}

function inspectPhysicalLineBudget(cwd: string, files: readonly string[], mode: 'repository' | 'touched', context: PhysicalLineBudgetContext): PhysicalLineBudgetReport {
  const policy = resolveAtomizationLinePolicy({ config: readRepoConfig(cwd) });
  const entries = [...new Set(files)]
    .map((file) => ({ file, lines: countLines(path.join(cwd, file)) }))
    .sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));
  const hardViolations = entries.filter((entry) => entry.lines > policy.maxLines);
  const softWarnings = entries.filter((entry) => entry.lines > softLines && entry.lines <= policy.maxLines);
  return {
    ok: hardViolations.length === 0,
    mode,
    scannedFiles: entries.length,
    maxLines: policy.maxLines,
    softLines,
    hardViolationCount: hardViolations.length,
    softWarningCount: softWarnings.length,
    topFile: entries[0] ?? null,
    hardViolations,
    softWarnings: softWarnings.slice(0, 25),
    context,
    reproduceCommand: buildReproduceCommand(mode, files, context)
  };
}

function scanSourceFiles(cwd: string): string[] {
  return scanRoots.flatMap((scanRoot) => walk(path.join(cwd, scanRoot), cwd));
}

function walk(directory: string, cwd: string): string[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(cwd, absolute).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (shouldSkipPath(relative)) continue;
      files.push(...walk(absolute, cwd));
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) continue;
    if (shouldSkipPath(relative)) continue;
    files.push(relative);
  }
  return files;
}

function shouldSkipPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  if (excludedPrefixes.some((prefix) => normalized.startsWith(prefix))) return true;
  return normalized.split('/').some((segment) => excludedSegments.has(segment));
}

function countLines(filePath: string): number {
  if (!statSync(filePath).isFile()) return 0;
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
}

function readRepoConfig(cwd: string): { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } } | null {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, 'utf8')) as { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } };
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function readTouchedArg(argv: readonly string[]): string[] {
  const value = readFlagValue(argv, '--touched');
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function buildReproduceCommand(mode: 'repository' | 'touched', files: readonly string[], context: PhysicalLineBudgetContext): string {
  const parts = ['node --strip-types scripts/validate-physical-line-budget.ts', '--json'];
  if (mode === 'touched') parts.push('--touched', files.map(normalizePath).join(','));
  if (context.taskId) parts.push('--task', context.taskId);
  if (context.actorId) parts.push('--actor', context.actorId);
  if (context.gate) parts.push('--gate', context.gate);
  return parts.map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
}

function isMainModule(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false;
}
