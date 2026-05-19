import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHashPlaceholderAudit } from '../packages/cli/src/commands/hash-placeholder-audit.ts';

export { runHashPlaceholderAudit };

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isDirectRun) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';
  const report = runHashPlaceholderAudit({ root });
  if (!report.ok) {
    for (const finding of report.findings) console.error(`[hash-placeholders:${mode}] ${finding.file}: ${finding.issue}`);
    process.exit(1);
  }
  console.log(`[hash-placeholders:${mode}] ok (${report.checked.length} protected registry/spec/example files checked)`);
}
