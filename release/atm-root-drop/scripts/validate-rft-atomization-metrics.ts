import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectTouchedPhysicalLineBudget, type PhysicalLineBudgetReport } from './validate-physical-line-budget.ts';

type AtomMapping = {
  readonly path_pattern: string;
  readonly atom_id: string;
  readonly coverage_status?: string;
  readonly source_task?: string;
};

export type RftAtomizationMetricsReport = {
  readonly ok: boolean;
  readonly schemaId: 'atm.rftAtomizationMetrics.v1';
  readonly generatedAt: string;
  readonly ownerAtomOrMapId: string;
  readonly touchedSourceCount: number;
  readonly extractedAtomCount: number;
  readonly inlineExceptionCount: number;
  readonly followUpCardCount: number;
  readonly filesLackingAtomizationOwnership: readonly string[];
  readonly semanticWarningCount: number;
  readonly semanticWarnings: readonly RftAtomizationWarning[];
  readonly physicalGate: {
    readonly ok: boolean;
    readonly hardViolationCount: number;
    readonly softWarningCount: number;
    readonly hardViolations: PhysicalLineBudgetReport['hardViolations'];
    readonly softWarnings: PhysicalLineBudgetReport['softWarnings'];
  };
  readonly evidenceMode: 'metrics-only';
  readonly reproduceCommand: string;
};

export type RftAtomizationWarning = {
  readonly code: 'RFT_ATOMIZATION_OWNER_MISSING' | 'RFT_ATOMIZATION_INLINE_EXCEPTION' | 'RFT_ATOMIZATION_FOLLOW_UP_CARD';
  readonly file: string;
  readonly detail: string;
};

const defaultMapPath = 'atomic_workbench/atomization-coverage/path-to-atom-map.json';
const sourceExtensions = new Set(['.ts', '.js', '.mjs', '.cjs']);

if (isMainModule()) {
  const argv = process.argv.slice(2);
  const cwd = process.cwd();
  const report = inspectRftAtomizationMetrics(cwd, {
    touchedFiles: readCsvFlag(argv, '--touched'),
    mapPath: readFlagValue(argv, '--map') ?? defaultMapPath,
    ownerAtomOrMapId: readFlagValue(argv, '--owner') ?? 'atm.rft-semantic-atomization-metrics',
    taskId: readFlagValue(argv, '--task'),
    actorId: readFlagValue(argv, '--actor')
  });
  const jsonMode = argv.includes('--json');
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`[rft-atomization-metrics] ok=${report.ok} touched=${report.touchedSourceCount} atoms=${report.extractedAtomCount} semanticWarnings=${report.semanticWarningCount} physicalHard=${report.physicalGate.hardViolationCount}`);
  }
  if (!report.ok) process.exitCode = 1;
}

export function inspectRftAtomizationMetrics(cwd: string, input: {
  readonly touchedFiles?: readonly string[];
  readonly mapPath?: string;
  readonly ownerAtomOrMapId?: string;
  readonly taskId?: string | null;
  readonly actorId?: string | null;
} = {}): RftAtomizationMetricsReport {
  const mapPath = normalizePath(input.mapPath ?? defaultMapPath);
  const mappings = readAtomMappings(path.join(cwd, mapPath));
  const touchedFiles = resolveTouchedSourceFiles(cwd, input.touchedFiles);
  const physicalGate = inspectTouchedPhysicalLineBudget(cwd, touchedFiles, {
    taskId: input.taskId,
    actorId: input.actorId,
    gate: 'rft-atomization-metrics'
  });
  const ownership = touchedFiles.map((file) => ({ file, mapping: findBestMapping(file, mappings) }));
  const missing = ownership.filter((entry) => !entry.mapping).map((entry) => entry.file);
  const inlineExceptionWarnings = ownership
    .filter((entry) => entry.mapping?.coverage_status === 'partial')
    .map((entry) => ({
      code: 'RFT_ATOMIZATION_INLINE_EXCEPTION' as const,
      file: entry.file,
      detail: 'Touched source is covered by a partial atom/map entry; record semantic review evidence before treating the split as semantically complete.'
    }));
  const followUpWarnings = ownership
    .filter((entry) => entry.mapping?.source_task && entry.mapping.source_task !== input.taskId)
    .map((entry) => ({
      code: 'RFT_ATOMIZATION_FOLLOW_UP_CARD' as const,
      file: entry.file,
      detail: `Touched source maps to prior/follow-up task ${entry.mapping?.source_task}; preserve continuity in closure evidence.`
    }));
  const missingWarnings = missing.map((file) => ({
    code: 'RFT_ATOMIZATION_OWNER_MISSING' as const,
    file,
    detail: 'Touched source has no matching atom/map ownership entry.'
  }));
  const atomIds = new Set(ownership.map((entry) => entry.mapping?.atom_id).filter((value): value is string => Boolean(value)));
  const semanticWarnings = [...missingWarnings, ...inlineExceptionWarnings, ...followUpWarnings];
  return {
    ok: physicalGate.ok,
    schemaId: 'atm.rftAtomizationMetrics.v1',
    generatedAt: new Date().toISOString(),
    ownerAtomOrMapId: input.ownerAtomOrMapId ?? 'atm.rft-semantic-atomization-metrics',
    touchedSourceCount: touchedFiles.length,
    extractedAtomCount: atomIds.size,
    inlineExceptionCount: inlineExceptionWarnings.length,
    followUpCardCount: followUpWarnings.length,
    filesLackingAtomizationOwnership: missing,
    semanticWarningCount: semanticWarnings.length,
    semanticWarnings,
    physicalGate: {
      ok: physicalGate.ok,
      hardViolationCount: physicalGate.hardViolationCount,
      softWarningCount: physicalGate.softWarningCount,
      hardViolations: physicalGate.hardViolations,
      softWarnings: physicalGate.softWarnings
    },
    evidenceMode: 'metrics-only',
    reproduceCommand: buildReproduceCommand(input)
  };
}

function readAtomMappings(mapFile: string): AtomMapping[] {
  if (!existsSync(mapFile)) return [];
  const parsed = JSON.parse(readFileSync(mapFile, 'utf8')) as { readonly mappings?: unknown };
  if (!Array.isArray(parsed.mappings)) return [];
  return parsed.mappings
    .map((entry) => normalizeMapping(entry))
    .filter((entry): entry is AtomMapping => entry !== null);
}

function normalizeMapping(value: unknown): AtomMapping | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pathPattern = typeof record.path_pattern === 'string' ? normalizePath(record.path_pattern) : '';
  const atomId = typeof record.atom_id === 'string' ? record.atom_id.trim() : '';
  if (!pathPattern || !atomId) return null;
  return {
    path_pattern: pathPattern,
    atom_id: atomId,
    coverage_status: typeof record.coverage_status === 'string' ? record.coverage_status : undefined,
    source_task: typeof record.source_task === 'string' ? record.source_task : undefined
  };
}

function findBestMapping(file: string, mappings: readonly AtomMapping[]): AtomMapping | null {
  const matches = mappings.filter((entry) => pathMatchesPattern(file, entry.path_pattern));
  if (matches.length === 0) return null;
  return matches.sort((left, right) => patternSpecificity(right.path_pattern) - patternSpecificity(left.path_pattern))[0] ?? null;
}

function pathMatchesPattern(file: string, pattern: string): boolean {
  const normalizedFile = normalizePath(file);
  const normalizedPattern = normalizePath(pattern).replace(/#.*$/, '');
  if (normalizedPattern === normalizedFile) return true;
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`).test(normalizedFile);
}

function patternSpecificity(pattern: string): number {
  return pattern.replace(/\*/g, '').length;
}

function resolveTouchedSourceFiles(cwd: string, input: readonly string[] | undefined): string[] {
  const touched = input && input.length > 0 ? input : [
    'scripts/validate-physical-line-budget.ts',
    'scripts/validate-rft-atomization-metrics.ts',
    'tests/cli/rft-atomization-metrics.test.ts'
  ];
  return [...new Set(touched.map(normalizePath))]
    .filter((file) => sourceExtensions.has(path.extname(file)))
    .filter((file) => existsSync(path.join(cwd, file)) && statSync(path.join(cwd, file)).isFile())
    .sort();
}

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function readCsvFlag(argv: readonly string[], flag: string): string[] {
  const value = readFlagValue(argv, flag);
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function buildReproduceCommand(input: { readonly touchedFiles?: readonly string[]; readonly mapPath?: string; readonly ownerAtomOrMapId?: string; readonly taskId?: string | null; readonly actorId?: string | null }): string {
  const parts = ['node --strip-types scripts/validate-rft-atomization-metrics.ts', '--json'];
  if (input.touchedFiles?.length) parts.push('--touched', input.touchedFiles.map(normalizePath).join(','));
  if (input.mapPath) parts.push('--map', normalizePath(input.mapPath));
  if (input.ownerAtomOrMapId) parts.push('--owner', input.ownerAtomOrMapId);
  if (input.taskId) parts.push('--task', input.taskId);
  if (input.actorId) parts.push('--actor', input.actorId);
  return parts.map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
}

function isMainModule(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false;
}
