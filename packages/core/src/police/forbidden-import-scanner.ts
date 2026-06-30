interface ImportRecord {
  readonly source?: string;
  readonly toLayer?: string;
}

interface ImportGraphEntry {
  readonly file?: string;
  readonly from?: string;
  readonly imports?: unknown[];
}

interface ForbiddenImportOptions {
  readonly checkId?: string;
  readonly description?: string;
}

function asImportRecord(value: unknown): ImportRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ImportRecord
    : null;
}

function asImportGraphEntry(value: unknown): ImportGraphEntry | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ImportGraphEntry
    : null;
}

export function extractImportSources(sourceText: string) {
  const sources: string[] = [];
  const patterns = [
    /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(sourceText);
    while (match) {
      sources.push(match[1]);
      match = pattern.exec(sourceText);
    }
  }
  return Array.from(new Set(sources));
}

export function validateForbiddenImports(importGraph: unknown[] = [], forbiddenPatterns: unknown[] = [], options: ForbiddenImportOptions = {}) {
  const violations: Array<{ code: string; severity: string; message: string; path: string }> = [];
  for (const rawEntry of importGraph) {
    const entry = asImportGraphEntry(rawEntry);
    if (!entry) {
      continue;
    }
    const imports = normalizeImports(entry.imports);
    for (const imported of imports) {
      for (const pattern of forbiddenPatterns) {
        if (matchesPattern(imported.source, pattern)) {
          violations.push({
            code: 'ATM_POLICE_FORBIDDEN_IMPORT',
            severity: 'error',
            message: `${entry.file ?? entry.from ?? 'source'} imports forbidden source ${imported.source}`,
            path: entry.file ?? ''
          });
        }
      }
    }
  }
  return {
    checkId: options.checkId ?? 'forbidden-import',
    kind: 'forbidden-import',
    required: true,
    description: options.description ?? 'Validate sources do not import forbidden implementation layers.',
    ok: violations.length === 0,
    violations
  };
}

export function normalizeImports(imports: unknown[] = []) {
  return imports
    .map((entry) => typeof entry === 'string' ? { source: entry } : asImportRecord(entry))
    .filter((entry): entry is ImportRecord => Boolean(entry?.source));
}

function matchesPattern(value: string | undefined, pattern: unknown) {
  const normalizedValue = String(value ?? '');
  if (pattern instanceof RegExp) {
    return pattern.test(normalizedValue);
  }
  const text = String(pattern ?? '');
  if (text.startsWith('/') && text.endsWith('/')) {
    return new RegExp(text.slice(1, -1)).test(normalizedValue);
  }
  return normalizedValue.includes(text);
}
