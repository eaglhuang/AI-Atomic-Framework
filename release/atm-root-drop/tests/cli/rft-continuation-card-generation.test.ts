import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateRftContinuationCards } from '../../scripts/generate-rft-continuation-cards.ts';
import type { PhysicalLineBudgetReport } from '../../scripts/validate-physical-line-budget.ts';
import type { RftAtomizationMetricsReport } from '../../scripts/validate-rft-atomization-metrics.ts';

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-rft-continuation-'));
const planningRoot = path.join(fixtureRoot, 'planning');
const targetRoot = path.join(fixtureRoot, 'target');
mkdirSync(path.join(planningRoot, 'docs/ai_atomic_framework/rft-hardening/tasks'), { recursive: true });
mkdirSync(path.join(targetRoot, '.atm/history/tasks'), { recursive: true });

writeFileSync(
  path.join(planningRoot, 'docs/ai_atomic_framework/rft-hardening/tasks/TASK-RFT-0101-existing.task.md'),
  '# TASK-RFT-0101\n\nscope:\n  - scripts/duplicate.ts\n'
);
writeFileSync(
  path.join(targetRoot, '.atm/history/tasks/TASK-RFT-0099.json'),
  JSON.stringify({ workItemId: 'TASK-RFT-0099', allowedPaths: ['scripts/settled.ts'] }, null, 2)
);

const baseLineBudget: PhysicalLineBudgetReport = {
  ok: true,
  mode: 'repository',
  scannedFiles: 2,
  maxLines: 600,
  softLines: 500,
  hardViolationCount: 0,
  softWarningCount: 0,
  topFile: null,
  hardViolations: [],
  softWarnings: [],
  context: {},
  reproduceCommand: 'node --strip-types scripts/validate-physical-line-budget.ts --json'
};

const report = generateRftContinuationCards({
  cwd: targetRoot,
  planningRoot,
  targetRoot,
  planningRootExplicit: true,
  targetRootExplicit: true,
  lineBudgetReport: baseLineBudget,
  semanticMetricsReport: metricsReport([
    {
      code: 'RFT_ATOMIZATION_OWNER_MISSING',
      file: 'scripts/new-surface.ts',
      detail: 'Touched source has no matching atom/map ownership entry.'
    },
    {
      code: 'RFT_ATOMIZATION_OWNER_MISSING',
      file: 'scripts/duplicate.ts',
      detail: 'Touched source has no matching atom/map ownership entry.'
    }
  ])
});

assert.equal(report.ok, true);
assert.equal(report.mode, 'dry-run');
assert.equal(report.nextProposedTaskId, 'TASK-RFT-0102');
assert.equal(report.candidateCount, 1);
assert.equal(report.skippedCandidateCount, 1);
assert.equal(report.candidates[0]?.taskId, 'TASK-RFT-0102');
assert.equal(report.candidates[0]?.scopePaths[0], 'scripts/new-surface.ts');
assert.match(report.candidates[0]?.cardText ?? '', /rollback:/);
assert.match(report.candidates[0]?.cardText ?? '', /atomization_impact:/);
assert.equal(report.skippedCandidates[0]?.reason, 'duplicate-existing-card');

const writeRefusal = generateRftContinuationCards({
  cwd: targetRoot,
  write: true,
  lineBudgetReport: baseLineBudget,
  semanticMetricsReport: metricsReport([])
});
assert.equal(writeRefusal.ok, false);
assert.equal(writeRefusal.errorCode, 'ATM_RFT_CONTINUATION_ROOTS_REQUIRED');

const writeReport = generateRftContinuationCards({
  cwd: targetRoot,
  planningRoot,
  targetRoot,
  planningRootExplicit: true,
  targetRootExplicit: true,
  write: true,
  lineBudgetReport: {
    ...baseLineBudget,
    softWarningCount: 1,
    softWarnings: [{ file: 'scripts/soft-budget.ts', lines: 540 }]
  },
  semanticMetricsReport: metricsReport([])
});
assert.equal(writeReport.ok, true);
assert.equal(writeReport.candidateCount, 1);
assert.ok(writeReport.candidates[0]?.writePath);
assert.equal(existsSync(writeReport.candidates[0]?.writePath ?? ''), true);

const emptyReport = generateRftContinuationCards({
  cwd: targetRoot,
  planningRoot,
  targetRoot,
  planningRootExplicit: true,
  targetRootExplicit: true,
  lineBudgetReport: baseLineBudget,
  semanticMetricsReport: metricsReport([])
});
assert.equal(emptyReport.candidateCount, 0);
assert.equal(emptyReport.skippedCandidates[0]?.reason, 'empty-inventory');

console.log('[rft-continuation-card-generation] ok generation, duplicate, empty inventory, and write guard passed');

function metricsReport(semanticWarnings: RftAtomizationMetricsReport['semanticWarnings']): RftAtomizationMetricsReport {
  return {
    ok: true,
    schemaId: 'atm.rftAtomizationMetrics.v1',
    generatedAt: new Date().toISOString(),
    ownerAtomOrMapId: 'atm.rft-continuation-card-generator',
    touchedSourceCount: semanticWarnings.length,
    extractedAtomCount: 0,
    inlineExceptionCount: 0,
    followUpCardCount: 0,
    filesLackingAtomizationOwnership: semanticWarnings.map((warning) => warning.file),
    semanticWarningCount: semanticWarnings.length,
    semanticWarnings,
    physicalGate: {
      ok: true,
      hardViolationCount: 0,
      softWarningCount: 0,
      hardViolations: [],
      softWarnings: []
    },
    evidenceMode: 'metrics-only',
    reproduceCommand: 'node --strip-types scripts/validate-rft-atomization-metrics.ts --json'
  };
}
