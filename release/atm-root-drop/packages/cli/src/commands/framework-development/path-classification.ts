export function isAtmCriticalNonDocSurface(filePath: string): boolean {
  const relativePath = normalizeFrameworkRelativePath(filePath);
  if (!relativePath || isDocOnlyPath(relativePath)) {
    return false;
  }
  if (relativePath === 'atm.mjs') return true;
  if (relativePath === 'package.json' || relativePath === 'package-lock.json') return true;
  if (/^tsconfig[^/]*\.json$/.test(relativePath)) return true;
  if (relativePath === 'atomic-registry.json') return true;
  if (/^compatibility-matrix[^/]*\.json$/.test(relativePath)) return true;
  return /^(packages|schemas|specs|scripts|templates|integrations|examples|tests)\//.test(relativePath);
}

export function isDocOnlyPath(filePath: string): boolean {
  const relativePath = normalizeFrameworkRelativePath(filePath);
  return relativePath === 'README.md'
    || relativePath === 'AGENTS.md'
    || relativePath.endsWith('.md')
    || relativePath.startsWith('docs/')
    || relativePath.startsWith('artifacts/')
    || relativePath.startsWith('fixtures/')
    || relativePath.startsWith('atomic_workbench/reports/')
    || relativePath.startsWith('atomic_workbench/evidence/');
}

export function hasAtmCriticalNonDocSurface(filePaths: readonly string[]): boolean {
  return filePaths.some((entry) => isAtmCriticalNonDocSurface(entry));
}

function normalizeFrameworkRelativePath(value: string): string {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}
