import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repeatedDigitDigestPattern = /sha256:([0-9a-f])\1{63}/i;

export function runHashPlaceholderAudit(options: { root?: string } = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const findings: { file: string; issue: string }[] = [];
  const files = [
    path.join(root, 'atomic-registry.json'),
    ...listJsonFiles(path.join(root, 'specs')),
    ...listExampleAtomSpecs(path.join(root, 'examples'))
  ];
  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const relativePath = relative(root, filePath);
    if (isAllowedPlaceholderPath(relativePath)) {
      continue;
    }
    const content = readFileSync(filePath, 'utf8');
    if (repeatedDigitDigestPattern.test(content)) findings.push({ file: relativePath, issue: 'placeholder-repeated-sha256-digest' });
    if (/placeholder digest|dummy digest/i.test(content)) findings.push({ file: relativePath, issue: 'placeholder-digest-text' });
  }
  return { ok: findings.length === 0, checked: files.filter(existsSync).map((filePath) => relative(root, filePath)), findings };
}

function listJsonFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listJsonFiles(fullPath));
    else if (entry.name.endsWith('.json')) results.push(fullPath);
  }
  return results;
}

function listExampleAtomSpecs(examplesRoot: string): string[] {
  if (!existsSync(examplesRoot)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(examplesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    results.push(...listJsonFiles(path.join(examplesRoot, entry.name, 'atoms')));
  }
  return results;
}

function isAllowedPlaceholderPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized.startsWith('fixtures/') || normalized.startsWith('tests/');
}

function relative(root: string, filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, '/');
}
