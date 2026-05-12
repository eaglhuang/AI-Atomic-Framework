import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zeroDigestPattern = /sha256:0{64}/i;

export function runHashPlaceholderAudit(options = {}) {
  const root = path.resolve(options.root ?? defaultRoot);
  const findings = [];
  const files = [path.join(root, 'atomic-registry.json'), ...listJsonFiles(path.join(root, 'specs'))];
  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf8');
    if (zeroDigestPattern.test(content)) findings.push({ file: relative(root, filePath), issue: 'placeholder-zero-sha256-digest' });
    if (/placeholder digest|dummy digest/i.test(content)) findings.push({ file: relative(root, filePath), issue: 'placeholder-digest-text' });
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
  console.log(`[hash-placeholders:${mode}] ok (${report.checked.length} protected registry/spec files checked)`);
}
