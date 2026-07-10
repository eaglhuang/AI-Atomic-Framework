import assert from 'node:assert/strict';
import {
  buildPreCommitBlockingFindings,
  buildPreCommitRepairHints,
  isPreCommitBaselineFinding,
  isPreCommitEnvironmentFinding
} from '../pre-commit.ts';
import { inspectGitIndexAccess } from '../git-index-diagnostics.ts';

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

console.log('[pre-commit.spec] ok');
