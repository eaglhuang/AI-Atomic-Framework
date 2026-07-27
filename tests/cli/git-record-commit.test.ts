// Regression coverage for ATM-BUG-2026-07-08-058.
//
// `git record-commit` is the official narrow lane for low-risk .atm/history
// record maintenance. It must not become a broad bypass for source changes or
// high-risk closure/repair/protected-override boundaries.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../packages/cli/src/commands/shared.ts';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';
import {
  classifyBlockLifecycleRecordBundle,
  recordOnlyClaimScopeExemptCovers,
  BLOCK_BRIDGE_REJECTION_CODES,
  type BlockBridgeLedgerState
} from '../../packages/cli/src/commands/git-governance/record-only-block-lifecycle-bridge.ts';

// ATM-GOV-0266: narrow record-only block-lifecycle bridge (pure classifier).
// Exactly one blocked/released ledger + its matching block event may pass a
// governed record-commit through an active framework claim; every other shape
// stays fail-closed.
{
  const ledger = (id: string) => `.atm/history/tasks/${id}.json`;
  const blockEvent = (id: string) =>
    `.atm/history/task-events/${id}/2026-07-27T08-48-46-260Z-block-f249ae664692.json`;
  const claimEvent = (id: string) =>
    `.atm/history/task-events/${id}/2026-07-27T07-04-56-138Z-claim-2b80082c9ea2.json`;
  const evidence = (id: string) => `.atm/history/evidence/${id}.runner-sync-receipt.json`;
  const blockedReleased: BlockBridgeLedgerState = { status: 'blocked', claimState: 'released' };
  const runningActive: BlockBridgeLedgerState = { status: 'running', claimState: 'active' };
  const reader = (map: Record<string, BlockBridgeLedgerState>) => (taskId: string) => map[taskId] ?? null;

  // Eligible: one blocked/released ledger + matching block event.
  const eligible = classifyBlockLifecycleRecordBundle({
    stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
    readLedgerState: reader({ 'TASK-SKL-0029': blockedReleased })
  });
  assert.equal(eligible.kind, 'eligible');
  if (eligible.kind === 'eligible') {
    assert.equal(eligible.taskId, 'TASK-SKL-0029');
    assert.deepEqual(
      [...eligible.exemptPaths],
      [blockEvent('TASK-SKL-0029'), ledger('TASK-SKL-0029')].sort()
    );
  }

  // Lone non-blocked ledger: not a block-lifecycle attempt, existing behaviour preserved.
  assert.equal(
    classifyBlockLifecycleRecordBundle({
      stagedFiles: [ledger('ATM-GOV-0240')],
      readLedgerState: reader({ 'ATM-GOV-0240': runningActive })
    }).kind,
    'not-block-lifecycle'
  );

  const rejectionOf = (files: string[], map: Record<string, BlockBridgeLedgerState>) => {
    const out = classifyBlockLifecycleRecordBundle({ stagedFiles: files, readLedgerState: reader(map) });
    assert.equal(out.kind, 'ineligible');
    return out.kind === 'ineligible' ? out.reasonCode : null;
  };

  // Incomplete pairs (event-only, ledger-only), extra records, mixed task,
  // non-blocked ledger, multiple block events, and missing ledger state.
  assert.equal(
    rejectionOf([blockEvent('ATM-GOV-0248')], { 'ATM-GOV-0248': blockedReleased }),
    BLOCK_BRIDGE_REJECTION_CODES.incompletePair
  );
  assert.equal(
    rejectionOf([ledger('ATM-GOV-0248')], { 'ATM-GOV-0248': blockedReleased }),
    BLOCK_BRIDGE_REJECTION_CODES.incompletePair
  );
  assert.equal(
    rejectionOf(
      [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029'), evidence('TASK-SKL-0029')],
      { 'TASK-SKL-0029': blockedReleased }
    ),
    BLOCK_BRIDGE_REJECTION_CODES.extraRecordFiles
  );
  assert.equal(
    rejectionOf(
      [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029'), claimEvent('TASK-SKL-0029')],
      { 'TASK-SKL-0029': blockedReleased }
    ),
    BLOCK_BRIDGE_REJECTION_CODES.extraRecordFiles
  );
  assert.equal(
    rejectionOf([ledger('ATM-GOV-0240'), blockEvent('ATM-GOV-0248')], {
      'ATM-GOV-0240': blockedReleased,
      'ATM-GOV-0248': blockedReleased
    }),
    BLOCK_BRIDGE_REJECTION_CODES.mixedTask
  );
  assert.equal(
    rejectionOf([ledger('ATM-GOV-0240'), blockEvent('ATM-GOV-0240')], { 'ATM-GOV-0240': runningActive }),
    BLOCK_BRIDGE_REJECTION_CODES.ledgerNotBlockedReleased
  );
  assert.equal(
    rejectionOf(
      [
        ledger('TASK-SKL-0029'),
        blockEvent('TASK-SKL-0029'),
        '.atm/history/task-events/TASK-SKL-0029/2026-07-27T09-00-00-000Z-block-aaaaaaaaaaaa.json'
      ],
      { 'TASK-SKL-0029': blockedReleased }
    ),
    BLOCK_BRIDGE_REJECTION_CODES.multipleBlockEvents
  );
  assert.equal(
    rejectionOf([ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')], {}),
    BLOCK_BRIDGE_REJECTION_CODES.ledgerMissing
  );

  // Exempt-cover predicate: only a full cover of a non-empty candidate set exempts.
  const exempt = [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')];
  assert.equal(recordOnlyClaimScopeExemptCovers(exempt, [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')]), true);
  assert.equal(recordOnlyClaimScopeExemptCovers(exempt, [ledger('TASK-SKL-0029'), 'packages/core/src/x.ts']), false);
  assert.equal(recordOnlyClaimScopeExemptCovers([], [ledger('TASK-SKL-0029')]), false);
  assert.equal(recordOnlyClaimScopeExemptCovers(exempt, []), false);

  console.log('[git-record-commit:test] block-lifecycle bridge classifier ok');
}

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function expectRecordCommitBlocked(repo: string, expectedCode: string) {
  let caught: unknown = null;
  try {
    await runAtmGit([
      'record-commit',
      '--cwd',
      repo,
      '--actor',
      'record-actor',
      '--message',
      'atm: blocked record commit',
      '--dry-run',
      '--json'
    ]);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof CliError, `expected ${expectedCode}, got ${String(caught)}`);
  assert.equal((caught as CliError).code, expectedCode);
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-record-commit-'));
const previousAtmGitName = process.env.ATM_GIT_NAME;
const previousAtmGitEmail = process.env.ATM_GIT_EMAIL;

try {
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.name', 'ATM Validator']);
  runGit(repo, ['config', 'user.email', 'validator@example.invalid']);
  runGit(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);

  process.env.ATM_GIT_NAME = 'Record Actor';
  process.env.ATM_GIT_EMAIL = 'record-actor@example.invalid';

  writeJson(path.join(repo, '.atm/history/tasks/TASK-RECORD-0001.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-RECORD-0001',
    status: 'open',
    title: 'Record lane fixture'
  });
  runGit(repo, ['add', '.atm/history/tasks/TASK-RECORD-0001.json']);

  const dryRun = await runAtmGit([
    'record-commit',
    '--cwd',
    repo,
    '--actor',
    'record-actor',
    '--message',
    'atm: sync record fixture',
    '--dry-run',
    '--json'
  ]);
  assert.equal(dryRun.ok, true);
  assert.equal((dryRun.evidence as Record<string, unknown>).action, 'record-commit');

  const commitResult = await runAtmGit([
    'record-commit',
    '--cwd',
    repo,
    '--actor',
    'record-actor',
    '--message',
    'atm: sync record fixture',
    '--json'
  ]);
  assert.equal(commitResult.ok, true);
  assert.equal((commitResult.evidence as Record<string, unknown>).action, 'record-commit');

  const log = runGit(repo, ['log', '-1', '--format=%B']);
  assert.match(log, /ATM-Actor: record-actor/);
  assert.match(log, /ATM-Record-Commit: true/);
  const committedFiles = runGit(repo, ['show', '--name-only', '--format=', 'HEAD']);
  assert.match(committedFiles, /\.atm\/history\/tasks\/TASK-RECORD-0001\.json/);
  assert.match(committedFiles, /\.atm\/history\/evidence\/git-head\.jsonl/);

  writeJson(path.join(repo, '.atm/history/tasks/TASK-RECORD-0001.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-RECORD-0001',
    status: 'done',
    title: 'Record lane fixture'
  });
  writeJson(path.join(repo, '.atm/history/tasks/TASK-RECORD-0002.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-RECORD-0002',
    status: 'done',
    title: 'Second record lane fixture'
  });
  runGit(repo, ['add', '.atm/history/tasks/TASK-RECORD-0001.json', '.atm/history/tasks/TASK-RECORD-0002.json']);
  await expectRecordCommitBlocked(repo, 'ATM_CROSS_TASK_MUTATION_BLOCKED');
  runGit(repo, ['restore', '--staged', '.atm/history/tasks/TASK-RECORD-0001.json', '.atm/history/tasks/TASK-RECORD-0002.json']);
  runGit(repo, ['restore', '.atm/history/tasks/TASK-RECORD-0001.json']);
  runGit(repo, ['clean', '-f', '--', '.atm/history/tasks/TASK-RECORD-0002.json']);

  writeFileSync(path.join(repo, 'src.ts'), 'export const source = true;\n', 'utf8');
  runGit(repo, ['add', 'src.ts']);
  await expectRecordCommitBlocked(repo, 'ATM_GIT_RECORD_COMMIT_SCOPE_VIOLATION');
  runGit(repo, ['restore', '--staged', 'src.ts']);

  writeJson(path.join(repo, '.atm/history/evidence/TASK-RECORD-0001.closure-packet.json'), {
    taskId: 'TASK-RECORD-0001',
    targetCommit: 'deadbeef'
  });
  runGit(repo, ['add', '.atm/history/evidence/TASK-RECORD-0001.closure-packet.json']);
  await expectRecordCommitBlocked(repo, 'ATM_GIT_RECORD_COMMIT_SCOPE_VIOLATION');

  console.log('[git-record-commit:test] ok');
} finally {
  if (previousAtmGitName === undefined) delete process.env.ATM_GIT_NAME; else process.env.ATM_GIT_NAME = previousAtmGitName;
  if (previousAtmGitEmail === undefined) delete process.env.ATM_GIT_EMAIL; else process.env.ATM_GIT_EMAIL = previousAtmGitEmail;
}
