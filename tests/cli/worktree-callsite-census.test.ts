import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync(process.execPath, ['--strip-types', 'scripts/validate-worktree-callsite-census.ts'], {
  cwd: process.cwd(),
  encoding: 'utf8'
});
const report = JSON.parse(output);

assert.equal(report.schemaId, 'atm.worktreeCallsiteCensus.v1');
assert.equal(report.ok, true);
assert.equal(report.unclassified.length, 0);
assert.equal(
  report.productionFindings.some((finding: any) => finding.file === 'packages/cli/src/commands/team/shadow-workspace.ts'),
  false
);
assert.equal(
  report.productionFindings.every((finding: any) => finding.classification !== 'unclassified' && finding.receiptContract),
  true
);

console.log('[worktree-callsite-census:test] ok');
