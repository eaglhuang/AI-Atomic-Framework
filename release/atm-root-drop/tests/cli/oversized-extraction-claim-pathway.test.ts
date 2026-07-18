import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateOversizedExtractionClaimAdmission } from '../../packages/cli/src/commands/next/oversized-extraction-admission.ts';
import type { PhysicalLineBudgetReport } from '../../packages/cli/src/commands/git-governance/commit-scope-policy.ts';

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function violationReport(taskId: string): PhysicalLineBudgetReport {
  return {
    ok: false,
    mode: 'touched',
    scannedFiles: 1,
    maxLines: 600,
    softLines: 500,
    hardViolationCount: 1,
    softWarningCount: 0,
    topFile: { file: 'packages/cli/src/commands/next/claim-orchestration.ts', lines: 636 },
    hardViolations: [{ file: 'packages/cli/src/commands/next/claim-orchestration.ts', lines: 636 }],
    softWarnings: [],
    context: { taskId, actorId: 'tester', gate: 'claim' },
    reproduceCommand: 'node --strip-types scripts/validate-physical-line-budget.ts --json'
  };
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-oversized-extraction-'));

try {
  const ordinaryTaskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-ORDINARY.json');
  writeJson(ordinaryTaskPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-ORDINARY',
    title: 'Ordinary claim work',
    status: 'planned'
  });
  const ordinary = evaluateOversizedExtractionClaimAdmission({
    cwd: repo,
    taskId: 'TASK-ORDINARY',
    taskPath: ordinaryTaskPath,
    report: violationReport('TASK-ORDINARY')
  });
  assert(!ordinary.allowed, 'ordinary tasks must not bypass oversized touched-file claim admission');

  const extractionTaskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-EXTRACT.json');
  writeJson(extractionTaskPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-EXTRACT',
    title: 'Extract oversized claim orchestration helper',
    status: 'planned',
    atomizationImpact: {
      extractionCandidates: [
        {
          atom: 'atm.claim.helper',
          source: 'packages/cli/src/commands/next/claim-orchestration.ts',
          disposition: 'extract'
        }
      ]
    }
  });
  const extraction = evaluateOversizedExtractionClaimAdmission({
    cwd: repo,
    taskId: 'TASK-EXTRACT',
    taskPath: extractionTaskPath,
    report: violationReport('TASK-EXTRACT')
  });
  assert(extraction.allowed, 'extraction-declared tasks should be admitted at claim stage');
  assert(extraction.metadata.enforcementBoundary === 'claim-only; pre-close and commit line-budget gates remain enforced', 'metadata must preserve downstream enforcement boundary');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[oversized-extraction-claim-pathway.test] ok');
