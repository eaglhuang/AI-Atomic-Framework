import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assert, createCommandRun, fixture, parsePayload, root, runCli, runGit, tempRoot, writeHistoricalRestorePacket, writeReadyFixtureTask } from './context.ts';
import { materializeValidatorFixture } from '../lib/validator-fixture.ts';

export function runClosureCrossChecks(noHooksDir: string) {
const closureRepo = path.join(tempRoot, 'closure-cross-check');
mkdirSync(closureRepo, { recursive: true });
materializeValidatorFixture(root, closureRepo, fixture);
runGit(closureRepo, ['init']);
runGit(closureRepo, ['config', 'user.email', 'atm@example.invalid']);
runGit(closureRepo, ['config', 'user.name', 'ATM Hook Validator']);
assert(parsePayload(runCli(closureRepo, ['bootstrap', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check bootstrap must report ok=true');
assert(parsePayload(runCli(closureRepo, ['atm-chart', 'render', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check atm-chart render must report ok=true');
assert(parsePayload(runCli(closureRepo, ['welcome', '--cwd', closureRepo, '--json'])).ok === true, 'closure-cross-check welcome must report ok=true');
runGit(closureRepo, ['add', '.']);
runGit(closureRepo, ['commit', '--no-verify', '-m', 'initial baseline']);

const restoreIdentity = parsePayload(runCli(closureRepo, ['identity', 'set', '--cwd', closureRepo, '--actor', 'restore-operator', '--git-name', 'Restore Operator', '--git-email', 'restore@example.invalid', '--json']));
assert(restoreIdentity.ok === true, 'historical restore hook fixture identity must be configurable');
const restoreHookTaskId = 'TASK-X-RESTORE';
const restoreHookFiles = writeHistoricalRestorePacket(closureRepo, restoreHookTaskId);
runGit(closureRepo, ['add', ...restoreHookFiles]);
const restoreHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], {
  env: {
    ATM_COMMIT_ACTOR_ID: 'restore-operator',
    ATM_COMMIT_TASK_ID: restoreHookTaskId,
    GIT_AUTHOR_NAME: 'Restore Operator',
    GIT_AUTHOR_EMAIL: 'restore@example.invalid'
  }
});
assert(restoreHook.status === 0, 'pre-commit hook must accept a complete done historical ledger restore packet without a fake legacy session');
runGit(closureRepo, ['reset', '--mixed', 'HEAD']);
for (const restoreHookFile of restoreHookFiles) {
  rmSync(path.join(closureRepo, restoreHookFile), { recursive: true, force: true });
}

const reconcileIdentity = parsePayload(runCli(closureRepo, ['identity', 'set', '--cwd', closureRepo, '--actor', 'fixture-agent', '--git-name', 'Fixture Agent', '--git-email', 'fixture-agent@example.com', '--json']));
assert(reconcileIdentity.ok === true, 'reconcile close-commit-window hook fixture identity must be configurable');
const reconcileHookTaskId = 'TASK-X-RECONCILE';
writeReadyFixtureTask(closureRepo, reconcileHookTaskId, 'fixture-agent', 'Reconcile hook close window regression');
writeFileSync(path.join(closureRepo, 'packages', 'core', 'src', 'reconcile-close-window.ts'), 'export const reconcileCloseWindow = true;\n', 'utf8');
assert(parsePayload(runCli(closureRepo, ['tasks', 'claim', '--cwd', closureRepo, '--task', reconcileHookTaskId, '--actor', 'fixture-agent', '--files', 'packages/core/src/reconcile-close-window.ts', '--json'])).ok === true, 'reconcile hook claim must report ok=true');
runGit(closureRepo, ['add', 'packages/core/src/reconcile-close-window.ts']);
const reconcileDeliveryCommit = parsePayload(runCli(closureRepo, ['git', 'commit', '--cwd', closureRepo, '--actor', 'fixture-agent', '--task', reconcileHookTaskId, '--message', 'feat: reconcile hook fixture delivery', '--json']));
assert(reconcileDeliveryCommit.ok === true, 'reconcile hook fixture delivery commit must report ok=true');
const reconcileDeliverySha = String(reconcileDeliveryCommit.evidence?.commitSha ?? '');
assert(reconcileDeliverySha.length > 0, 'reconcile hook fixture delivery commit must return commit sha');
const reconcileApproval = parsePayload(runCli(closureRepo, [
  'emergency',
  'approve',
  '--cwd', closureRepo,
  '--task', reconcileHookTaskId,
  '--actor', 'fixture-agent',
  '--permission', 'backend.tasks.reconcile',
  '--approval-text', 'Human approved reconcile hook fixture backend repair',
  '--reason', 'Validator fixture exercises the protected reconcile close-window contract.',
  '--json'
]));
assert(reconcileApproval.ok === true, 'reconcile hook fixture emergency approval must report ok=true');
const reconcileApprovalLease = String(reconcileApproval.evidence?.lease?.leaseId ?? reconcileApproval.evidence?.approval?.leaseId ?? reconcileApproval.evidence?.leaseId ?? '');
assert(reconcileApprovalLease.length > 0, 'reconcile hook fixture emergency approval must return a lease id');
const reconcileClose = parsePayload(runCli(closureRepo, ['tasks', 'reconcile', '--cwd', closureRepo, '--task', reconcileHookTaskId, '--actor', 'fixture-agent', '--delivery-commit', reconcileDeliverySha, '--emergency-approval', reconcileApprovalLease, '--json']));
assert(reconcileClose.ok === true, 'reconcile hook close step must report ok=true');
const reconcilePreCommit = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], {
  env: {
    ATM_COMMIT_ACTOR_ID: 'fixture-agent',
    ATM_COMMIT_TASK_ID: reconcileHookTaskId,
    GIT_AUTHOR_NAME: 'Fixture Agent',
    GIT_AUTHOR_EMAIL: 'fixture-agent@example.com'
  }
});
assert(reconcilePreCommit.status === 0, 'pre-commit hook must accept reconcile close packets covered by an active close-commit-window without a session id');
assert(parsePayload(runCli(closureRepo, ['git-hooks', 'install', '--framework-required', '--json'])).ok === true, 'reconcile child-hook fixture must install git hooks before native child commit');
const reconcileStagedBeforeChildCommit = String(runGit(closureRepo, ['diff', '--cached', '--name-only']).stdout || '').trim().split(/\r?\n/).filter(Boolean);
assert(reconcileStagedBeforeChildCommit.includes('.atm/history/evidence/TASK-X-RECONCILE.closure-packet.json'), 'reconcile parent pre-commit must keep the closure packet staged for the child hook');
assert(reconcileStagedBeforeChildCommit.includes('.atm/history/evidence/TASK-X-RECONCILE.json'), 'reconcile parent pre-commit must keep the task evidence bundle staged for the child hook');
assert(reconcileStagedBeforeChildCommit.includes('.atm/history/evidence/git-head.jsonl'), 'reconcile parent pre-commit must stage git-head evidence for the child hook handoff');
const reconcileChildCommit = runGit(closureRepo, ['commit', '-m', 'close reconcile hook fixture window'], {
  allowFailure: true,
  env: {
    ATM_COMMIT_ACTOR_ID: 'fixture-agent',
    ATM_COMMIT_TASK_ID: reconcileHookTaskId,
    GIT_AUTHOR_NAME: 'Fixture Agent',
    GIT_AUTHOR_EMAIL: 'fixture-agent@example.com'
  }
});
assert(reconcileChildCommit.status === 0, `reconcile child git commit must succeed after parent pre-commit refresh without stale git-head evidence failure\nstdout:\n${reconcileChildCommit.stdout || ''}\nstderr:\n${reconcileChildCommit.stderr || ''}`);
const reconcileChildTouchedPaths = String(runGit(closureRepo, ['show', '--pretty=', '--name-only', 'HEAD']).stdout || '').trim().split(/\r?\n/).filter(Boolean);
assert(reconcileChildTouchedPaths.includes('.atm/history/evidence/TASK-X-RECONCILE.closure-packet.json'), 'reconcile child commit must include the closure packet staged by the parent pre-commit');
assert(reconcileChildTouchedPaths.includes('.atm/history/evidence/TASK-X-RECONCILE.json'), 'reconcile child commit must include the reconciled task evidence bundle');
assert(reconcileChildTouchedPaths.includes('.atm/history/evidence/git-head.jsonl'), 'reconcile child commit must persist git-head evidence generated by the parent pre-commit');
runGit(closureRepo, ['reset', '--mixed', 'HEAD']);
runGit(closureRepo, ['checkout', '--', 'packages/core/src/reconcile-close-window.ts']);

// TASK-CID-0024: same-file parallel claims must be claimable side by side,
// pre-commit must not fail purely because one staged file is covered by
// multiple active claims, and ambiguous mixed staged content without
// steward/broker evidence must still be rejected.
const sameFileTaskA = 'TASK-X-SAME-A';
const sameFileTaskB = 'TASK-X-SAME-B';
for (const sameFileTaskId of [sameFileTaskA, sameFileTaskB]) {
  writeReadyFixtureTask(closureRepo, sameFileTaskId, 'fixture-agent', `Same-file claim fixture ${sameFileTaskId}`);
}
writeFileSync(path.join(closureRepo, 'docs', 'same-file-shared.md'), '# shared fixture\n', 'utf8');
writeFileSync(path.join(closureRepo, 'docs', 'same-file-a-only.md'), '# a only fixture\n', 'utf8');
writeFileSync(path.join(closureRepo, 'docs', 'same-file-b-only.md'), '# b only fixture\n', 'utf8');
const sameFileClaimA = parsePayload(runCli(closureRepo, ['tasks', 'claim', '--cwd', closureRepo, '--task', sameFileTaskA, '--actor', 'fixture-agent', '--files', 'docs/same-file-shared.md,docs/same-file-a-only.md', '--json']));
assert(sameFileClaimA.ok === true, 'same-file claim A must report ok=true');
const sameFileClaimB = parsePayload(runCli(closureRepo, ['tasks', 'claim', '--cwd', closureRepo, '--task', sameFileTaskB, '--actor', 'fixture-agent', '--files', 'docs/same-file-shared.md,docs/same-file-b-only.md', '--json']));
assert(sameFileClaimB.ok === true, 'same-file claim B must be claimable in parallel with claim A on the same file');

const sameFileHookEnv = {
  ATM_COMMIT_ACTOR_ID: 'fixture-agent',
  ATM_COMMIT_TASK_ID: sameFileTaskA,
  GIT_AUTHOR_NAME: 'Fixture Agent',
  GIT_AUTHOR_EMAIL: 'fixture-agent@example.com'
};
runGit(closureRepo, ['add', 'docs/same-file-shared.md']);
const sameFileOwnedHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], { allowFailure: true, env: sameFileHookEnv });
// ATM-GOV-0250 supersedes the TASK-CID-0024 allowance: a multi-claim shared
// write fails closed until a consumed steward receipt binds its blob digest,
// even when the committing task owns one of the claims.
assert(sameFileOwnedHook.status === 1, `pre-commit hook must fail closed on a multi-claim shared write without a steward receipt\nstdout:\n${sameFileOwnedHook.stdout}\nstderr:\n${sameFileOwnedHook.stderr}`);
const sameFileOwnedPayload = parsePayload(sameFileOwnedHook);
assert((sameFileOwnedPayload.evidence?.sameFileClaimReport?.multiClaimFiles ?? []).some((entry: any) => entry.file === 'docs/same-file-shared.md'), 'pre-commit evidence must record the same-file multi-claim coverage');
assert((sameFileOwnedPayload.evidence?.sameFileClaimReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_BROKER_STEWARD_RECEIPT_REQUIRED' && entry.file === 'docs/same-file-shared.md'), 'multi-claim shared write without a receipt must emit ATM_BROKER_STEWARD_RECEIPT_REQUIRED');
runGit(closureRepo, ['reset', '--mixed', 'HEAD']);

runGit(closureRepo, ['add', 'docs/same-file-b-only.md']);
const sameFileAmbiguousHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], { allowFailure: true, env: sameFileHookEnv });
assert(sameFileAmbiguousHook.status === 1, 'pre-commit hook must reject mixed staged content owned by another active write claim without steward/broker evidence');
const sameFileAmbiguousPayload = parsePayload(sameFileAmbiguousHook);
assert((sameFileAmbiguousPayload.evidence?.sameFileClaimReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS' && entry.file === 'docs/same-file-b-only.md'), 'ambiguous staged ownership must emit ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS');
runGit(closureRepo, ['reset', '--mixed', 'HEAD']);
const sameFileClaimLaneByTask = new Map<string, string | null>([
  [sameFileTaskA, typeof sameFileClaimA.evidence?.claim?.laneSession?.laneSessionId === 'string' ? sameFileClaimA.evidence.claim.laneSession.laneSessionId : null],
  [sameFileTaskB, typeof sameFileClaimB.evidence?.claim?.laneSession?.laneSessionId === 'string' ? sameFileClaimB.evidence.claim.laneSession.laneSessionId : null]
]);
for (const sameFileTaskId of [sameFileTaskA, sameFileTaskB]) {
  const laneSessionId = sameFileClaimLaneByTask.get(sameFileTaskId);
  assert(parsePayload(runCli(closureRepo, ['tasks', 'release', '--cwd', closureRepo, '--task', sameFileTaskId, '--actor', 'fixture-agent', '--reason', 'same-file fixture cleanup', '--json'], {
    env: laneSessionId ? { ATM_LANE_SESSION_ID: laneSessionId } : undefined
  })).ok === true, `${sameFileTaskId} release must report ok=true`);
}
rmSync(path.join(closureRepo, 'docs', 'same-file-shared.md'), { force: true });
rmSync(path.join(closureRepo, 'docs', 'same-file-a-only.md'), { force: true });
rmSync(path.join(closureRepo, 'docs', 'same-file-b-only.md'), { force: true });

const mixedRestoreHookTaskId = 'TASK-X-RESTORE-MIXED';
const mixedRestoreHookFiles = writeHistoricalRestorePacket(closureRepo, mixedRestoreHookTaskId);
writeFileSync(path.join(closureRepo, 'packages', 'core', 'src', 'restore-bypass.ts'), 'export const restoreBypass = true;\n', 'utf8');
runGit(closureRepo, ['add', ...mixedRestoreHookFiles, 'packages/core/src/restore-bypass.ts']);
const mixedRestoreHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], {
  allowFailure: true,
  env: {
    ATM_COMMIT_ACTOR_ID: 'restore-operator',
    ATM_COMMIT_TASK_ID: mixedRestoreHookTaskId,
    GIT_AUTHOR_NAME: 'Restore Operator',
    GIT_AUTHOR_EMAIL: 'restore@example.invalid'
  }
});
assert(mixedRestoreHook.status === 1, 'pre-commit hook must reject historical restore packets mixed with source files');
const mixedRestoreHookPayload = parsePayload(mixedRestoreHook);
assert((mixedRestoreHookPayload.evidence?.commitAttributionReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_COMMIT_SESSION_MISSING'), 'mixed restore hook refusal must fall back to normal active-task session enforcement');
runGit(closureRepo, ['reset', '--mixed', 'HEAD']);
rmSync(path.join(closureRepo, 'packages', 'core', 'src', 'restore-bypass.ts'), { force: true });

const openRestoreHookTaskId = 'TASK-X-RESTORE-OPEN';
const openRestoreHookFiles = writeHistoricalRestorePacket(closureRepo, openRestoreHookTaskId, 'running');
runGit(closureRepo, ['add', ...openRestoreHookFiles]);
writeHistoricalRestorePacket(closureRepo, openRestoreHookTaskId, 'done');
const openRestoreHook = runCli(closureRepo, ['hook', 'pre-commit', '--cwd', closureRepo, '--json'], {
  allowFailure: true,
  env: {
    ATM_COMMIT_ACTOR_ID: 'restore-operator',
    ATM_COMMIT_TASK_ID: openRestoreHookTaskId,
    GIT_AUTHOR_NAME: 'Restore Operator',
    GIT_AUTHOR_EMAIL: 'restore@example.invalid'
  }
});
assert(openRestoreHook.status === 1, 'pre-commit hook must reject historical restore packets whose staged task ledger is not done');
const openRestoreHookPayload = parsePayload(openRestoreHook);
assert((openRestoreHookPayload.evidence?.commitAttributionReport?.findings ?? []).some((entry: any) => entry.code === 'ATM_COMMIT_SESSION_MISSING'), 'non-done restore hook refusal must fall back to normal active-task session enforcement');
runGit(closureRepo, ['reset', '--mixed', 'HEAD']);

writeFileSync(path.join(closureRepo, 'packages', 'core', 'src', 'index.ts'), 'export const bypass = "closure-cross-check";\n', 'utf8');
runGit(closureRepo, ['add', 'packages/core/src/index.ts']);
const governedTreeSha = runGit(closureRepo, ['write-tree']);
const parentCommitSha = runGit(closureRepo, ['rev-parse', 'HEAD']);
writeFileSync(path.join(closureRepo, '.atm', 'history', 'evidence', 'git-head.jsonl'), `${JSON.stringify({
  schemaVersion: 'atm.gitHeadEvidence.v0.1',
  evidence: [
    {
      evidenceKind: 'validation',
      summary: 'Git commit tree is covered by ATM Integration Hook Contract v1.',
      artifactPaths: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      producedBy: 'validate-git-hooks-enforcement',
      commandRuns: [
        createCommandRun('npm run typecheck', 'sha256:1111111111111111111111111111111111111111111111111111111111111111'),
        createCommandRun('npm run validate:cli', 'sha256:2222222222222222222222222222222222222222222222222222222222222222'),
        createCommandRun('npm run validate:git-head-evidence', 'sha256:3333333333333333333333333333333333333333333333333333333333333333')
      ],
      details: {
        git: {
          treeSha: governedTreeSha,
          parentCommitShas: [parentCommitSha],
          stagedPathCount: 1,
          evidencePath: '.atm/history/evidence/git-head.jsonl',
          generatedAt: '2026-01-01T00:00:00.000Z'
        },
        hookContractVersion: 'atm.integration-hooks/v1',
        runnerVersion: '0.1.0'
      }
    }
  ]
})}\n`, 'utf8');
writeFileSync(path.join(closureRepo, '.atm', 'history', 'evidence', 'TASK-X-9001.closure-packet.json'), `${JSON.stringify({
  schemaId: 'atm.closurePacket.v1',
  specVersion: '0.1.0',
  taskId: 'TASK-X-9001',
  targetRepoIdentity: {
    isFrameworkRepo: true,
    score: 4,
    root: closureRepo,
    name: 'ai-atomic-framework',
    signals: ['package-name', 'packages-core', 'packages-cli', 'atomic-registry']
  },
  targetCommit: parentCommitSha,
  governedTreeSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  targetCommitDelta: {
    currentCommitSha: parentCommitSha,
    parentCommitShas: [parentCommitSha],
    governedTreeSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    changedFiles: ['packages/core/src/index.ts']
  },
  closedByCommand: 'atm tasks close',
  commandRuns: [
    createCommandRun('npm run typecheck', 'sha256:1111111111111111111111111111111111111111111111111111111111111111'),
    createCommandRun('npm run validate:cli', 'sha256:2222222222222222222222222222222222222222222222222222222222222222'),
    createCommandRun('npm run validate:git-head-evidence', 'sha256:3333333333333333333333333333333333333333333333333333333333333333')
  ],
  validationPasses: ['typecheck', 'validate:cli', 'validate:git-head-evidence'],
  evidenceFreshness: 'fresh',
  requiredGates: ['framework-development', 'tasks-audit', 'doctor', 'git-head-evidence', 'typecheck', 'validate:cli', 'validate:git-head-evidence'],
  requiredGatesSnapshot: {
    schemaId: 'atm.requiredGatesSnapshot.v1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    source: 'frameworkStatus.requiredGates',
    ruleVersion: '0.1.0',
    frameworkMode: 'required',
    repoRole: 'framework',
    changedFiles: ['packages/core/src/index.ts'],
    criticalChangedFiles: ['packages/core/src/index.ts'],
    requiredGates: ['framework-development', 'tasks-audit', 'doctor', 'git-head-evidence', 'typecheck', 'validate:cli', 'validate:git-head-evidence']
  },
  evidencePath: '.atm/history/evidence/TASK-X-9001.json',
  closedAt: '2026-01-01T00:00:00.000Z',
  closedByActor: 'validate-git-hooks-enforcement'
}, null, 2)}\n`, 'utf8');
runGit(closureRepo, ['add', '.atm/history/evidence/git-head.jsonl', '.atm/history/evidence/TASK-X-9001.closure-packet.json']);
runGit(closureRepo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'bypass hooks with mismatched closure packet']);
const mismatchedClosureCommitSha = String(runGit(closureRepo, ['rev-parse', 'HEAD']).stdout || '').trim();

const closureCommitRange = runCli(closureRepo, ['guard', 'commit-range', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
const closureCommitRangePayload = parsePayload(closureCommitRange);
assert(closureCommitRange.status === 1, 'commit-range guard must fail for mismatched closure packet');
const closureFindings = closureCommitRangePayload.evidence?.report?.findings ?? [];
assert(closureFindings.some((entry: any) => entry.code === 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TREE_MISMATCH'), 'commit-range guard must detect closure packet tree mismatches against governed commit delta');
const closureMismatchFinding = closureFindings.find((entry: any) => entry.code === 'ATM_COMMIT_RANGE_CLOSURE_PACKET_TREE_MISMATCH');
const closureMismatchSuggestedFix = closureMismatchFinding?.suggestedFix
  ?? closureMismatchFinding?.suggested_fix
  ?? closureMismatchFinding?.data?.suggestedFix
  ?? closureMismatchFinding?.data?.suggested_fix
  ?? closureMismatchFinding?.data?.suggestedCommand;
assert(typeof closureMismatchSuggestedFix === 'string' && closureMismatchSuggestedFix.includes('closure-packet'), 'closure packet tree mismatch finding must include an actionable suggested fix');

const repairApproval = parsePayload(runCli(closureRepo, [
  'emergency',
  'approve',
  '--cwd', closureRepo,
  '--task', 'TASK-X-9001',
  '--actor', 'fixture-agent',
  '--permission', 'backend.tasks.repairClosure',
  '--approval-text', 'Human approved repair-closure hook fixture backend repair',
  '--reason', 'Validator fixture exercises the protected closure-packet repair contract.',
  '--json'
]));
assert(repairApproval.ok === true, 'repair-closure hook fixture emergency approval must report ok=true');
const repairApprovalLease = String(repairApproval.evidence?.lease?.leaseId ?? repairApproval.evidence?.approval?.leaseId ?? repairApproval.evidence?.leaseId ?? '');
assert(repairApprovalLease.length > 0, 'repair-closure hook fixture emergency approval must return a lease id');
const repairPayload = parsePayload(runCli(closureRepo, ['tasks', 'repair-closure', '--task', 'TASK-X-9001', '--actor', 'fixture-agent', '--emergency-approval', repairApprovalLease, '--json']));
assert(repairPayload.ok === true, 'tasks repair-closure must stage a repaired closure packet');
const repairedPacketPath = path.join(closureRepo, '.atm', 'history', 'evidence', 'TASK-X-9001.closure-packet.json');
const repairedPacket = JSON.parse(readFileSync(repairedPacketPath, 'utf8'));
assert(repairedPacket.repair?.schemaId === 'atm.closurePacketRepair.v1', 'repaired closure packet must carry explicit repair metadata');
assert(repairedPacket.repair?.originalPacketCommitSha === mismatchedClosureCommitSha, 'repair metadata must identify the original packet commit');
runGit(closureRepo, ['commit', '--no-verify', '-m', 'repair mismatched closure packet']);
const repairedClosureRange = runCli(closureRepo, ['guard', 'commit-range', '--base', 'HEAD~2', '--head', 'HEAD', '--json'], { allowFailure: true });
assert(repairedClosureRange.status === 0, `commit-range guard must accept an explicit closure packet repair follow-up\nstdout:\n${repairedClosureRange.stdout}\nstderr:\n${repairedClosureRange.stderr}`);

// ATM-GOV-0250: every shared-write entry point must admit through the one
// shared verifier; adapters may gather evidence but never re-implement policy.
const sharedWriteVerifierModule = 'shared-write-provenance-policy.ts';
const sharedWriteCallSites = [
  'packages/core/src/broker/shared-delivery-commit.ts',
  'packages/cli/src/commands/hook/pre-commit/scope-ownership.ts',
  'packages/cli/src/commands/hook/pre-commit/support.ts',
  'packages/cli/src/commands/broker/batch-execute-actions.ts'
];
for (const callSite of sharedWriteCallSites) {
  const source = readFileSync(path.join(root, callSite), 'utf8');
  assert(source.includes(sharedWriteVerifierModule), `${callSite} must import the shared shared-write admission verifier`);
  assert(!/ATM_BROKER_STEWARD_RECEIPT_(REQUIRED|INVALID)\s*=/.test(source), `${callSite} must not redefine steward receipt error codes locally`);
}

}
