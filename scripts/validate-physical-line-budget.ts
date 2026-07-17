import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveAtomizationLinePolicy } from '../packages/cli/src/commands/tasks/task-import-validators.ts';

type BudgetEntry = {
  readonly file: string;
  readonly lines: number;
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
const policy = resolveAtomizationLinePolicy({ config: readRepoConfig(root) });
const entries = scanSourceFiles(root)
  .map((file) => ({ file, lines: countLines(path.join(root, file)) }))
  .sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));
const hardViolations = entries.filter((entry) => entry.lines > policy.maxLines);
const softWarnings = entries.filter((entry) => entry.lines > softLines && entry.lines <= policy.maxLines);
const report = {
  ok: hardViolations.length === 0,
  scannedFiles: entries.length,
  maxLines: policy.maxLines,
  softLines,
  hardViolationCount: hardViolations.length,
  softWarningCount: softWarnings.length,
  topFile: entries[0] ?? null,
  hardViolations,
  softWarnings: softWarnings.slice(0, 25)
};

if (jsonMode) {
  const stream = report.ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (report.ok) {
  console.log(`[physical-line-budget] ok scanned=${report.scannedFiles} hard=0 soft=${report.softWarningCount} top=${report.topFile?.file ?? 'none'}:${report.topFile?.lines ?? 0}`);
} else {
  console.error(`[physical-line-budget] failed scanned=${report.scannedFiles} hard=${report.hardViolationCount} max=${report.maxLines}`);
  for (const entry of hardViolations) {
    console.error(`- ${entry.file}: ${entry.lines}`);
  }
}

if (!report.ok) process.exitCode = 1;

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
  const normalized = relativePath.replace(/\\/g, '/');
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
