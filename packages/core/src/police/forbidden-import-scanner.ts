export function extractImportSources(sourceText: any) {
  const sources: any[] = [];
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

export function validateForbiddenImports(importGraph: any[] = [], forbiddenPatterns: any[] = [], options: any = {}) {
  const violations: any[] = [];
  for (const entry of importGraph) {
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

export function normalizeImports(imports: any[] = []) {
  return imports.map((entry) => typeof entry === 'string' ? { source: entry } : entry).filter((entry) => entry?.source);
}

function matchesPattern(value: any, pattern: any) {
  if (pattern instanceof RegExp) {
    return pattern.test(value);
  }
  const text = String(pattern ?? '');
  if (text.startsWith('/') && text.endsWith('/')) {
    return new RegExp(text.slice(1, -1)).test(value);
  }
  return value.includes(text);
}
