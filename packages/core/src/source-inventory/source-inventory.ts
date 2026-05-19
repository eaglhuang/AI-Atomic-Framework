/**
 * Source inventory contract for Decomposition Police (APF-0031).
 *
 * Produces a read-only inventory of source surfaces with line counts,
 * language hints, entrypoints, and legacy URIs. Does not modify any
 * host project. 1000 LOC is the configurable default threshold.
 */

export const DEFAULT_MAX_FILE_LINES = 1000;

export interface SourceInventoryEntry {
  readonly filePath: string;
  readonly language?: string;
  readonly lineCount: number;
  readonly exportedSymbols?: readonly string[];
  readonly entrypointHint?: string;
  readonly legacyUri?: string;
  readonly ignoredReason?: string;
  readonly hasActiveReplacementMap?: boolean;
  readonly replacementMapId?: string;
}

export interface SourceInventoryReport {
  readonly schemaId: 'atm.sourceInventoryReport';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly maxFileLines: number;
  readonly entries: readonly SourceInventoryEntry[];
  readonly ignoredPathPatterns: readonly string[];
}

export interface BuildSourceInventoryInput {
  readonly entries: readonly Partial<SourceInventoryEntry> & { filePath: string; lineCount: number }[];
  readonly maxFileLines?: number;
  readonly generatedAt?: string;
  readonly ignoredPathPatterns?: readonly string[];
}

const DEFAULT_IGNORED_PATTERNS: readonly string[] = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.git/',
  'release/'
];

export function buildSourceInventoryReport(input: BuildSourceInventoryInput): SourceInventoryReport {
  const maxFileLines = input.maxFileLines ?? DEFAULT_MAX_FILE_LINES;
  const ignoredPathPatterns = input.ignoredPathPatterns ?? DEFAULT_IGNORED_PATTERNS;
  const normalized = (input.entries as readonly Partial<SourceInventoryEntry>[]).map((entry) => normalizeEntry(entry, ignoredPathPatterns));
  return {
    schemaId: 'atm.sourceInventoryReport',
    specVersion: '0.1.0',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    maxFileLines,
    entries: normalized,
    ignoredPathPatterns: [...ignoredPathPatterns]
  };
}

export function isPathIgnored(filePath: string, ignoredPathPatterns: readonly string[]): boolean {
  return ignoredPathPatterns.some((pattern) => filePath.includes(pattern));
}

function normalizeEntry(entry: Partial<SourceInventoryEntry>, ignoredPathPatterns: readonly string[]): SourceInventoryEntry {
  const filePath = String(entry.filePath ?? '').trim();
  if (!filePath) {
    throw new Error('SourceInventoryEntry.filePath is required.');
  }
  const lineCount = Number(entry.lineCount ?? 0);
  const language = entry.language?.trim();
  const ignoredReason = entry.ignoredReason
    ?? (isPathIgnored(filePath, ignoredPathPatterns) ? 'ignored-by-pattern' : undefined);

  return {
    filePath,
    language,
    lineCount,
    exportedSymbols: entry.exportedSymbols ? [...entry.exportedSymbols] : undefined,
    entrypointHint: entry.entrypointHint,
    legacyUri: entry.legacyUri ?? filePath,
    ignoredReason,
    hasActiveReplacementMap: entry.hasActiveReplacementMap ?? false,
    replacementMapId: entry.replacementMapId
  };
}

export function filterEligibleForDecomposition(
  report: SourceInventoryReport
): readonly SourceInventoryEntry[] {
  return report.entries.filter((entry) => {
    if (entry.ignoredReason) return false;
    if (entry.hasActiveReplacementMap) return false;
    if (entry.lineCount <= report.maxFileLines) return false;
    return true;
  });
}
