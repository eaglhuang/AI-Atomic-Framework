import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repeatedDigitDigestPattern = /sha256:([0-9a-f])\1{63}/i;

export function runHashPlaceholderAudit(options = {}) {
  const root = path.resolve(options.root ?? defaultRoot);
  const findings = [];
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

function listJsonFiles(directory) {
  if (!existsSync(directory)) return [];
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listJsonFiles(fullPath));
    else if (entry.name.endsWith('.json')) results.push(fullPath);
  }
  return results;
}

function listExampleAtomSpecs(examplesRoot) {
  if (!existsSync(examplesRoot)) return [];
  const results = [];
  for (const entry of readdirSync(examplesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    results.push(...listJsonFiles(path.join(examplesRoot, entry.name, 'atoms')));
  }
  return results;
}

function isAllowedPlaceholderPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized.startsWith('fixtures/') || normalized.startsWith('tests/');
}

function relative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isDirectRun) {
  const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';
  const report = runHashPlaceholderAudit();
  if (!report.ok) {
    for (const finding of report.findings) console.error(`[hash-placeholders:${mode}] ${finding.file}: ${finding.issue}`);
    process.exit(1);
  }
  console.log(`[hash-placeholders:${mode}] ok (${report.checked.length} protected registry/spec/example files checked)`);
}
