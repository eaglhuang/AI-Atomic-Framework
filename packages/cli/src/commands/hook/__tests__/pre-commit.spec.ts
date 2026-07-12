import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPreCommitBlockingFindings,
  buildPreCommitRepairHints,
  isPreCommitBaselineFinding,
  isPreCommitEnvironmentFinding
} from '../pre-commit.ts';
import { inspectGitIndexAccess } from '../git-index-diagnostics.ts';
import {
  captureGitHeadEvidencePreparation,
  reconcileResolvedCrossTaskMutationIncident,
  rollbackFailedGitHeadEvidencePreparation
} from '../../git-governance.ts';

const cwd = process.cwd();
const gitIndex = inspectGitIndexAccess(cwd);
const requiredCommand = 'node atm.mjs git commit --actor cursor-composer-rft0002 --task TASK-RFT-0002 --message "delivery" --json';

const cleanFindings = buildPreCommitBlockingFindings({
  encodingReport: { findings: [], inspectedFileCount: 0, ok: true, schemaId: 'atm.encodingHookReport.v1' },
  gitIndexDiagnostic: gitIndex,
  blockingFrameworkIssues: [],
  frameworkClaimCommand: null,
  staleLocks: [],
  planningMirrorDriftFiles: [],
  directionLockDriftFiles: [],
  quickfixDriftFiles: [],
  quickfixFileLimitExceeded: false,
  quickfixLineLimitExceeded: false,
  quickfixChangedLineCount: 0,
  commitAttributionFindings: [],
  protectedStateFindings: [],
  emergencyUseAuditFindings: [],
  taskCardStatusFindings: [],
  sameFileClaimFindings: [],
  taskAuditFindings: [],
  failedValidatorRuns: [],
  stagedFiles: [],
  advisoryFindingsSink: [],
  crossFileConsistencyFindings: [],
  residueFindings: []
});
assert.equal(cleanFindings.length, 0);

const attributionBlock = buildPreCommitBlockingFindings({
  encodingReport: { findings: [], inspectedFileCount: 0, ok: true, schemaId: 'atm.encodingHookReport.v1' },
  gitIndexDiagnostic: gitIndex,
  blockingFrameworkIssues: [],
  frameworkClaimCommand: null,
  staleLocks: [],
  planningMirrorDriftFiles: [],
  directionLockDriftFiles: [],
  quickfixDriftFiles: [],
  quickfixFileLimitExceeded: false,
  quickfixLineLimitExceeded: false,
  quickfixChangedLineCount: 0,
  commitAttributionFindings: [{
    code: 'ATM_GIT_COMMIT_WRAPPER_REQUIRED',
    source: 'commit-attribution',
    detail: 'Governed commits must use the ATM git commit wrapper.',
    requiredCommand,
    classification: 'current-task'
  }],
  protectedStateFindings: [],
  emergencyUseAuditFindings: [],
  taskCardStatusFindings: [],
  sameFileClaimFindings: [],
  taskAuditFindings: [],
  failedValidatorRuns: [],
  stagedFiles: ['packages/cli/src/commands/hook.ts'],
  advisoryFindingsSink: [],
  crossFileConsistencyFindings: [],
  residueFindings: []
});
assert.ok(attributionBlock.some((entry) => entry.source === 'commit-attribution'));
assert.equal(attributionBlock[0]?.code, 'ATM_GIT_COMMIT_WRAPPER_REQUIRED');

const repairHints = buildPreCommitRepairHints(attributionBlock, requiredCommand);
assert.ok(repairHints.some((hint) => hint.includes('node atm.mjs git commit')));

const envFinding = {
  code: 'ATM_GIT_INDEX_PERMISSION_DENIED',
  source: 'git-index',
  detail: 'permission denied',
  classification: 'environment' as const
};
assert.equal(isPreCommitEnvironmentFinding(envFinding), true);
assert.equal(isPreCommitBaselineFinding({ code: 'X', source: 'baseline', detail: 'd', classification: 'baseline' }), true);

const sandboxFinding = {
  code: 'ATM_ENV_SANDBOX_GIT_EPERM',
  source: 'environment',
  detail: 'sandbox',
  classification: 'environment' as const
};
const sandboxHints = buildPreCommitRepairHints([sandboxFinding], null);
assert.ok(sandboxHints[0]?.includes('ATM_TEMP_ROOT'));

const baselineOnly = buildPreCommitBlockingFindings({
  encodingReport: { findings: [], inspectedFileCount: 0, ok: true, schemaId: 'atm.encodingHookReport.v1' },
  gitIndexDiagnostic: { ...gitIndex, ok: true },
  blockingFrameworkIssues: [],
  frameworkClaimCommand: null,
  staleLocks: [],
  planningMirrorDriftFiles: [],
  directionLockDriftFiles: [],
  quickfixDriftFiles: [],
  quickfixFileLimitExceeded: false,
  quickfixLineLimitExceeded: false,
  quickfixChangedLineCount: 0,
  commitAttributionFindings: [],
  protectedStateFindings: [],
  emergencyUseAuditFindings: [],
  taskCardStatusFindings: [],
  sameFileClaimFindings: [],
  taskAuditFindings: [],
  failedValidatorRuns: [],
  stagedFiles: [],
  advisoryFindingsSink: [],
  crossFileConsistencyFindings: [],
  residueFindings: []
});
assert.equal(baselineOnly.filter(isPreCommitEnvironmentFinding).length, 0);

const repairRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-git-governance-repair-'));
try {
  const evidencePath = path.join(repairRoot, '.atm', 'history', 'evidence', 'git-head.jsonl');
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, '{"prepared":"before"}\n', 'utf8');
  const snapshot = captureGitHeadEvidencePreparation(repairRoot);
  writeFileSync(evidencePath, '{"prepared":"before"}\n{"prepared":"orphan"}\n', 'utf8');
  assert.equal(rollbackFailedGitHeadEvidencePreparation(snapshot), true);
  assert.equal(readFileSync(evidencePath, 'utf8'), '{"prepared":"before"}\n');

  const absentRoot = path.join(repairRoot, 'absent');
  const absentSnapshot = captureGitHeadEvidencePreparation(absentRoot);
  const absentEvidencePath = path.join(absentRoot, '.atm', 'history', 'evidence', 'git-head.jsonl');
  mkdirSync(path.dirname(absentEvidencePath), { recursive: true });
  writeFileSync(absentEvidencePath, '{"prepared":"orphan"}\n', 'utf8');
  assert.equal(rollbackFailedGitHeadEvidencePreparation(absentSnapshot), true);
  assert.equal(existsSync(absentEvidencePath), false);

  const incidentsPath = path.join(repairRoot, '.atm', 'runtime', 'incidents');
  mkdirSync(incidentsPath, { recursive: true });
  writeFileSync(path.join(incidentsPath, 'stale.json'), JSON.stringify({ schemaId: 'atm.incidentReport.v1', block: {} }), 'utf8');
  assert.equal(reconcileResolvedCrossTaskMutationIncident(repairRoot, null), true);
  assert.equal(existsSync(path.join(incidentsPath, 'stale.json')), false);
} finally {
  rmSync(repairRoot, { recursive: true, force: true });
}

console.log('[pre-commit.spec] ok');
