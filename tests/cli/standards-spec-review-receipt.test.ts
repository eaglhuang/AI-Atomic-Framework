import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runReviewAdvisory } from '../../packages/cli/src/commands/review-advisory.ts';
import { buildTaskflowClosePreflight } from '../../packages/cli/src/commands/taskflow/close-preflight.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-standards-spec-review-'));
mkdirSync(path.join(root, '.atm/history/reports/review-advisory'), { recursive: true });
mkdirSync(path.join(root, 'src'), { recursive: true });
writeFileSync(path.join(root, 'src/feature.ts'), 'export const value = 1;\n', 'utf8');
writeFileSync(path.join(root, 'standards.md'), 'AtomicCharter and repo skill rules.\n', 'utf8');
writeFileSync(path.join(root, 'spec.md'), 'Task acceptance and validator requirements.\n', 'utf8');
execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'atm-test'], { cwd: root, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'atm-test@example.invalid'], { cwd: root, stdio: 'ignore' });
execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'baseline'], { cwd: root, stdio: 'ignore' });

const reportPath = '.atm/history/reports/review-advisory/TASK-SKL-0021.json';
const advisory = runReviewAdvisory([
  '--cwd', root,
  '--mode', 'stub',
  '--stub-profile', 'pass',
  '--task', 'TASK-SKL-0021',
  '--standards-spec-receipt',
  '--target-kind', 'scope',
  '--target-id', 'TASK-SKL-0021',
  '--source-path', 'src/feature.ts',
  '--standards-source', 'standards.md',
  '--spec-source', 'spec.md',
  '--out', reportPath,
  '--json'
]);

assert.equal(advisory.ok, true);
const advisoryEvidence = advisory.evidence as any;
assert.equal(advisoryEvidence.report.standardsSpecReceipt.taskId, 'TASK-SKL-0021');
assert.equal(advisoryEvidence.report.standardsSpecReceipt.schemaId, 'atm.standardsSpecReviewReceipt.v1');
assert.equal(advisoryEvidence.report.standardsSpecReceipt.dispositions.every((entry: any) => entry.disposition !== 'unresolved'), true);

const taskDocument = {
  workItemId: 'TASK-SKL-0021',
  evidenceRequired: 'standards-spec-review-candidate-seal',
  scopePaths: ['src/feature.ts'],
  deliverables: ['src/feature.ts']
};

const previewCommitBundle = {
  targetRepo: { stageFiles: [] },
  planningRepo: { repoRoot: null, stageFiles: [] },
  targetDeliveryFiles: [],
  targetGovernanceFiles: [],
  planningFiles: []
};

const ready = buildTaskflowClosePreflight({
  cwd: root,
  taskId: 'TASK-SKL-0021',
  actorId: 'codex-test',
  taskDocument,
  previewCommitBundle,
  historicalDeliveryRefs: [],
  waiverOutOfScopeDelivery: false,
  waiverReason: null
});
assert.equal(ready.blockers.some((entry: any) => entry.code === 'ATM_STANDARDS_SPEC_REVIEW_RECEIPT_REQUIRED'), false);

writeFileSync(path.join(root, 'src/feature.ts'), 'export const value = 2;\n', 'utf8');
const stale = buildTaskflowClosePreflight({
  cwd: root,
  taskId: 'TASK-SKL-0021',
  actorId: 'codex-test',
  taskDocument,
  previewCommitBundle,
  historicalDeliveryRefs: [],
  waiverOutOfScopeDelivery: false,
  waiverReason: null
});
const staleBlocker = stale.blockers.find((entry: any) => entry.code === 'ATM_STANDARDS_SPEC_REVIEW_RECEIPT_REQUIRED') as any;
assert.ok(staleBlocker);
assert.match(staleBlocker.summary, /candidate-stale/);

writeFileSync(path.join(root, 'src/feature.ts'), 'export const value = 1;\n', 'utf8');
runReviewAdvisory([
  '--cwd', root,
  '--mode', 'stub',
  '--stub-profile', 'warn',
  '--task', 'TASK-SKL-0021',
  '--standards-spec-receipt',
  '--target-kind', 'scope',
  '--target-id', 'TASK-SKL-0021',
  '--source-path', 'src/feature.ts',
  '--standards-source', 'standards.md',
  '--spec-source', 'spec.md',
  '--out', reportPath,
  '--json'
]);
const unresolved = buildTaskflowClosePreflight({
  cwd: root,
  taskId: 'TASK-SKL-0021',
  actorId: 'codex-test',
  taskDocument,
  previewCommitBundle,
  historicalDeliveryRefs: [],
  waiverOutOfScopeDelivery: false,
  waiverReason: null
});
const unresolvedBlocker = unresolved.blockers.find((entry: any) => entry.code === 'ATM_STANDARDS_SPEC_REVIEW_RECEIPT_REQUIRED') as any;
assert.ok(unresolvedBlocker);
assert.match(unresolvedBlocker.summary, /unresolved-findings/);

console.log('[standards-spec-review-receipt] ok');
