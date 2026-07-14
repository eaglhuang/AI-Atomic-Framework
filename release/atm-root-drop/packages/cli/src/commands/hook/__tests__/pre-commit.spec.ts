import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPreCommitBlockingFindings,
  buildPreCommitFailureEnvelope,
  buildPreCommitRepairHints,
  isPreCommitBaselineFinding,
  isPreCommitEnvironmentFinding,
  summarizePreCommitFailureEnvelope,
  selectActionableResidueFindings
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

const rawDestructiveHints = buildPreCommitRepairHints([{
  code: 'ATM_RAW_DESTRUCTIVE_GIT',
  source: 'generated-residue',
  detail: 'raw destructive remediation is not operator-safe',
  requiredCommand: 'git reset --hard',
  classification: 'current-task',
  blockerKind: 'governance-state'
}], null);
assert.equal(rawDestructiveHints.some((hint) => /git reset --hard/i.test(hint)), false);
assert.ok(rawDestructiveHints[0]?.includes('ATM repair/reconcile'));

const summaryEnvelope = buildPreCommitFailureEnvelope({
  blockingFindings: attributionBlock,
  frameworkClaimCommand: null,
  gitIndexDiagnostic: gitIndex,
  failedValidatorRuns: []
});
const summary = summarizePreCommitFailureEnvelope(summaryEnvelope);
assert.ok(summary.startsWith('ATM_GIT_COMMIT_WRAPPER_REQUIRED:'), 'pre-commit failure summary must lead with the first blocking code');
assert.ok(summary.includes('node atm.mjs git commit'), 'summary must include governed recovery');

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

const terminalForeignResidue = {
  path: '.atm/history/evidence/TASK-DONE.bundle-manifest.json',
  verdict: 'block-and-explain' as const,
  reason: 'bundle-manifest belongs to another task.',
  ownerTaskId: 'TASK-DONE',
  cleanupAction: null
};
assert.equal(selectActionableResidueFindings({
  findings: [terminalForeignResidue],
  stagedFiles: [],
  committingTaskId: 'TASK-CURRENT',
  activeLockTaskIds: new Set(),
  hasActiveClaim: () => false,
  hasTerminalOwner: () => true
}).length, 0);
assert.equal(selectActionableResidueFindings({
  findings: [terminalForeignResidue],
  stagedFiles: ['.atm/history/evidence/TASK-DONE.bundle-manifest.json'],
  committingTaskId: 'TASK-CURRENT',
  activeLockTaskIds: new Set(),
  hasActiveClaim: () => false,
  hasTerminalOwner: () => true
}).length, 1);

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
  const locksPath = path.join(repairRoot, '.atm', 'runtime', 'locks');
  mkdirSync(incidentsPath, { recursive: true });
  mkdirSync(locksPath, { recursive: true });
  writeFileSync(path.join(locksPath, 'TASK-FOREIGN.lock.json'), JSON.stringify({
    schemaId: 'atm.governanceScopeLock',
    workItemId: 'TASK-FOREIGN',
    actorId: 'foreign-agent',
    files: ['packages/cli/src/commands/hook/pre-commit.ts']
  }), 'utf8');
  writeFileSync(path.join(incidentsPath, 'active.json'), JSON.stringify({
    schemaId: 'atm.incidentReport.v1',
    block: {
      conflictTaskId: 'TASK-FOREIGN',
      conflictFiles: ['packages/cli/src/commands/hook/pre-commit.ts'],
      commandFamily: 'pre-commit',
      recoveryLane: 'repair-claim',
      conflicts: [{
        conflictTaskId: 'TASK-FOREIGN',
        conflictFiles: ['packages/cli/src/commands/hook/pre-commit.ts'],
        owner: 'foreign-agent',
        surface: 'task-history'
      }]
    }
  }), 'utf8');
  assert.equal(reconcileResolvedCrossTaskMutationIncident(repairRoot, null), true);
  assert.equal(existsSync(path.join(incidentsPath, 'active.json')), false);
} finally {
  rmSync(repairRoot, { recursive: true, force: true });
}

console.log('[pre-commit.spec] ok');
