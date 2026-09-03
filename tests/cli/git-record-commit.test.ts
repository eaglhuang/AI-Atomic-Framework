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
  isRecordCommitBlockBridgeAuthorized,
  recordOnlyClaimScopeExemptCovers,
  BLOCK_BRIDGE_REJECTION_CODES,
  type BlockBridgeEligible,
  type BlockBridgeEventRecord,
  type BlockBridgeLedgerRecord,
  type RecordCommitBlockBridgeAuthorization
} from '../../packages/cli/src/commands/git-governance/record-only-block-lifecycle-bridge.ts';

// ATM-GOV-0266: narrow record-only block-lifecycle bridge (pure classifier).
// Exactly one blocked/released ledger + its matching block event may pass a
// governed record-commit through an active framework claim; every other shape
// stays fail-closed. Authorization rests on parsed ledger + event *content*
// (task id, block action, retained actor/lease attribution) — never the file
// name alone.
{
  const ledger = (id: string) => `.atm/history/tasks/${id}.json`;
  const blockEvent = (id: string) =>
    `.atm/history/task-events/${id}/2026-07-27T08-48-46-260Z-block-f249ae664692.json`;
  const claimEvent = (id: string) =>
    `.atm/history/task-events/${id}/2026-07-27T07-04-56-138Z-claim-2b80082c9ea2.json`;
  const evidence = (id: string) => `.atm/history/evidence/${id}.runner-sync-receipt.json`;

  const ledgerRecord = (id: string, over: Partial<BlockBridgeLedgerRecord> = {}): BlockBridgeLedgerRecord => ({
    workItemId: id,
    status: 'blocked',
    claimState: 'released',
    claimActorId: 'actor-a',
    claimLeaseId: 'lease-1',
    ...over
  });
  const eventRecord = (id: string, over: Partial<BlockBridgeEventRecord> = {}): BlockBridgeEventRecord => ({
    taskId: id,
    action: 'block',
    toStatus: 'blocked',
    actorId: 'actor-a',
    taskPath: ledger(id),
    ...over
  });

  type Fixture = {
    stagedFiles: string[];
    ledgers?: Record<string, BlockBridgeLedgerRecord | null>;
    events?: Record<string, BlockBridgeEventRecord | null>;
  };
  const classify = (fx: Fixture) =>
    classifyBlockLifecycleRecordBundle({
      stagedFiles: fx.stagedFiles,
      readLedgerRecord: (taskId) => (fx.ledgers && taskId in fx.ledgers ? fx.ledgers[taskId] : null),
      readEventRecord: (eventPath) => (fx.events && eventPath in fx.events ? fx.events[eventPath] : null)
    });

  // Eligible: one blocked/released ledger + matching block event, content agrees.
  const eligible = classify({
    stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
    ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
    events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029') }
  });
  assert.equal(eligible.kind, 'eligible');
  if (eligible.kind === 'eligible') {
    assert.equal(eligible.taskId, 'TASK-SKL-0029');
    assert.equal(eligible.actorId, 'actor-a');
    assert.equal(eligible.leaseId, 'lease-1');
    assert.deepEqual(
      [...eligible.exemptPaths],
      [blockEvent('TASK-SKL-0029'), ledger('TASK-SKL-0029')].sort()
    );
  }

  // Lone non-blocked ledger: not a block-lifecycle attempt, existing behaviour preserved.
  assert.equal(
    classify({
      stagedFiles: [ledger('ATM-GOV-0240')],
      ledgers: { 'ATM-GOV-0240': ledgerRecord('ATM-GOV-0240', { status: 'running', claimState: 'active' }) }
    }).kind,
    'not-block-lifecycle'
  );

  const rejectionOf = (fx: Fixture) => {
    const out = classify(fx);
    assert.equal(out.kind, 'ineligible', `expected ineligible, got ${out.kind}`);
    return out.kind === 'ineligible' ? out.reasonCode : null;
  };

  // Incomplete pairs (event-only, ledger-only).
  assert.equal(
    rejectionOf({
      stagedFiles: [blockEvent('ATM-GOV-0248')],
      events: { [blockEvent('ATM-GOV-0248')]: eventRecord('ATM-GOV-0248') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.incompletePair
  );
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('ATM-GOV-0248')],
      ledgers: { 'ATM-GOV-0248': ledgerRecord('ATM-GOV-0248') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.incompletePair
  );

  // Extra records: evidence file, or a second (claim) event, alongside the pair.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029'), evidence('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.extraRecordFiles
  );
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029'), claimEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.extraRecordFiles
  );

  // Mixed task by event path segment.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('ATM-GOV-0240'), blockEvent('ATM-GOV-0248')],
      ledgers: { 'ATM-GOV-0240': ledgerRecord('ATM-GOV-0240') },
      events: { [blockEvent('ATM-GOV-0248')]: eventRecord('ATM-GOV-0248') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.mixedTask
  );

  // Ledger present but not blocked/released.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('ATM-GOV-0240'), blockEvent('ATM-GOV-0240')],
      ledgers: { 'ATM-GOV-0240': ledgerRecord('ATM-GOV-0240', { status: 'running', claimState: 'active' }) },
      events: { [blockEvent('ATM-GOV-0240')]: eventRecord('ATM-GOV-0240') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.ledgerNotBlockedReleased
  );

  // Multiple block events.
  const secondBlock = '.atm/history/task-events/TASK-SKL-0029/2026-07-27T09-00-00-000Z-block-aaaaaaaaaaaa.json';
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029'), secondBlock],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: {
        [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029'),
        [secondBlock]: eventRecord('TASK-SKL-0029')
      }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.multipleBlockEvents
  );

  // Missing live ledger state.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.ledgerMissing
  );

  // Ledger document self-id disagrees with its path.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029', { workItemId: 'TASK-OTHER-9999' }) },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.ledgerIdMismatch
  );

  // Forged filename: file named `-block-` but its content is not a block transition.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029', { action: 'claim', toStatus: 'running' }) }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.eventNotBlock
  );

  // Event unparseable (staged block-named file with no readable content).
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: { [blockEvent('TASK-SKL-0029')]: null }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.eventUnreadable
  );

  // Mismatched event JSON: content task id / taskPath disagree with the ledger.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029', { taskId: 'TASK-OTHER-9999' }) }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.eventTaskMismatch
  );
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029', { taskPath: '.atm/history/tasks/TASK-OTHER-9999.json' }) }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.eventTaskMismatch
  );

  // Missing actor-or-lease attribution.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029', { claimLeaseId: null }) },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029') }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.attributionMissing
  );
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029', { actorId: null }) }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.attributionMissing
  );

  // Attribution mismatch: event actor differs from retained ledger claim actor.
  assert.equal(
    rejectionOf({
      stagedFiles: [ledger('TASK-SKL-0029'), blockEvent('TASK-SKL-0029')],
      ledgers: { 'TASK-SKL-0029': ledgerRecord('TASK-SKL-0029') },
      events: { [blockEvent('TASK-SKL-0029')]: eventRecord('TASK-SKL-0029', { actorId: 'actor-b' }) }
    }),
    BLOCK_BRIDGE_REJECTION_CODES.attributionMismatch
  );

  // Governed record-commit authorization verifier (hook parity).
  const eligibleFixture = eligible as BlockBridgeEligible;
  const goodAuth: RecordCommitBlockBridgeAuthorization = {
    nonce: 'abc123',
    actorId: 'actor-a',
    taskId: 'TASK-SKL-0029',
    exemptPaths: [...eligibleFixture.exemptPaths],
    ledgerPath: eligibleFixture.ledgerPath,
    ledgerSha256: 'led-sha',
    eventPath: eligibleFixture.eventPath,
    eventSha256: 'evt-sha',
    createdAtMs: 1_000,
    ttlMs: 120_000
  };
  const verify = (over: Partial<Parameters<typeof isRecordCommitBlockBridgeAuthorized>[0]> = {}) =>
    isRecordCommitBlockBridgeAuthorized({
      eligible: eligibleFixture,
      authorization: goodAuth,
      committingActorId: 'actor-a',
      ledgerSha256: 'led-sha',
      eventSha256: 'evt-sha',
      nowMs: 5_000,
      ...over
    }).authorized;
  assert.equal(verify(), true, 'valid governed authorization is accepted');
  assert.equal(verify({ authorization: null }), false, 'raw git (no authorization) is rejected');
  assert.equal(verify({ ledgerSha256: 'tampered' }), false, 'staged content digest mismatch is rejected');
  assert.equal(verify({ nowMs: goodAuth.createdAtMs + goodAuth.ttlMs + 1 }), false, 'expired authorization is rejected');
  assert.equal(verify({ committingActorId: 'actor-b' }), false, 'committing-actor mismatch is rejected');
  assert.equal(
    isRecordCommitBlockBridgeAuthorized({
      eligible: eligibleFixture,
      authorization: { ...goodAuth, exemptPaths: [eligibleFixture.ledgerPath] },
      committingActorId: 'actor-a',
      ledgerSha256: 'led-sha',
      eventSha256: 'evt-sha',
      nowMs: 5_000
    }).authorized,
    false
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

function runFrozenAtmJson(repo: string, args: string[]) {
  const atmEntrypoint = path.resolve('atm.mjs');
  const stdout = execFileSync(process.execPath, [atmEntrypoint, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ATM_GIT_NAME: 'Record Actor',
      ATM_GIT_EMAIL: 'record-actor@example.invalid'
    }
  });
  void repo;
  return JSON.parse(stdout) as Record<string, unknown>;
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

  const frozenDryRun = runFrozenAtmJson(repo, [
    'git',
    'record-commit',
    '--cwd',
    repo,
    '--actor',
    'record-actor',
    '--message',
    'atm: frozen record fixture',
    '--dry-run',
    '--json'
  ]);
  assert.equal(frozenDryRun.ok, true);
  assert.equal((frozenDryRun.evidence as Record<string, unknown>).action, 'record-commit');

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

  // ATM-BUG-2026-07-31-007: task-import recovery must preserve dry-run/write
  // parity. A single task ledger and its matching import transition are a
  // low-risk record bundle, not a cross-task mutation merely because the task
  // was imported rather than delivered through a live claim.
  const importedTaskId = 'TASK-IMPORT-0001';
  const importedLedgerPath = `.atm/history/tasks/${importedTaskId}.json`;
  const importedEventPath = `.atm/history/task-events/${importedTaskId}/2026-09-02T09-00-00-000Z-import-fixture.json`;
  writeJson(path.join(repo, importedLedgerPath), {
    schemaVersion: 'atm.workItem.v0.2', workItemId: importedTaskId, status: 'planned', title: 'Imported record fixture'
  });
  writeJson(path.join(repo, importedEventPath), {
    schemaId: 'atm.taskTransition.v1', taskId: importedTaskId, action: 'import', toStatus: 'planned', taskPath: importedLedgerPath
  });
  runGit(repo, ['add', importedLedgerPath, importedEventPath]);
  const importDryRun = await runAtmGit([
    'record-commit', '--cwd', repo, '--actor', 'record-actor',
    '--message', 'atm: import record fixture', '--dry-run', '--json'
  ]);
  assert.equal(importDryRun.ok, true);
  const importCommit = await runAtmGit([
    'record-commit', '--cwd', repo, '--actor', 'record-actor',
    '--message', 'atm: import record fixture', '--json'
  ]);
  assert.equal(importCommit.ok, true, 'an import record bundle accepted by dry-run must commit through the same hook boundary');
  const importCommittedFiles = runGit(repo, ['show', '--name-only', '--format=', 'HEAD']);
  assert.match(importCommittedFiles, /TASK-IMPORT-0001\.json/);
  assert.equal(runGit(repo, ['diff', '--cached', '--name-only']).trim(), '', 'import record commit must leave no staged residue');

  // ATM-BUG-2026-07-29-274: a forward historical-attestation ledger is a
  // single-task record. It must cross the actual pre-commit hook, not merely
  // pass record-commit dry-run classification.
  const attestationPath = `.atm/history/evidence/${importedTaskId}.historical-work-admission-attestations.json`;
  writeJson(path.join(repo, attestationPath), {
    schemaId: 'atm.historicalWorkAdmissionAttestationLedger.v1',
    attestations: [{ taskId: importedTaskId, commitSha: 'a'.repeat(40) }]
  });
  runGit(repo, ['add', attestationPath]);
  const attestationDryRun = await runAtmGit([
    'record-commit', '--cwd', repo, '--actor', 'record-actor',
    '--message', 'atm: historical attestation fixture', '--dry-run', '--json'
  ]);
  assert.equal(attestationDryRun.ok, true);
  const attestationCommit = await runAtmGit([
    'record-commit', '--cwd', repo, '--actor', 'record-actor',
    '--message', 'atm: historical attestation fixture', '--json'
  ]);
  assert.equal(attestationCommit.ok, true, 'attestation record dry-run/write must cross the same hook boundary');
  assert.match(runGit(repo, ['show', '--name-only', '--format=', 'HEAD']), /historical-work-admission-attestations\.json/);
  assert.equal(runGit(repo, ['diff', '--cached', '--name-only']).trim(), '', 'attestation record commit must leave no staged residue');

  // ATM-BUG-2026-09-02-002: an explicit record-only path must be staged by
  // the governed command itself, while an unrelated source file remains out
  // of both the index and the resulting commit.
  const explicitRecordPath = '.atm/history/evidence/TASK-RECORD-0001.note.json';
  writeJson(path.join(repo, 'package.json'), { name: 'ai-atomic-framework' });
  mkdirSync(path.join(repo, 'packages/core/src'), { recursive: true });
  writeFileSync(path.join(repo, 'packages/core/src/index.ts'), 'export {};\n', 'utf8');
  writeJson(path.join(repo, explicitRecordPath), { taskId: 'TASK-RECORD-0001', kind: 'record-only' });
  writeFileSync(path.join(repo, 'foreign-source.ts'), 'export const foreignSource = true;\n', 'utf8');
  const explicitDryRun = await runAtmGit([
    'record-commit', '--cwd', repo, '--actor', 'record-actor',
    '--message', 'atm: explicit record fixture', '--paths', explicitRecordPath,
    '--dry-run', '--json'
  ]);
  assert.equal(explicitDryRun.ok, true);
  assert.deepEqual((explicitDryRun.evidence as Record<string, unknown>).stagedFiles, [explicitRecordPath]);
  assert.equal(runGit(repo, ['diff', '--cached', '--name-only']).trim(), '', 'dry-run must not stage a record path');
  const explicitCommit = await runAtmGit([
    'record-commit', '--cwd', repo, '--actor', 'record-actor',
    '--message', 'atm: explicit record fixture', '--paths', explicitRecordPath,
    '--json'
  ]);
  assert.equal(explicitCommit.ok, true);
  const explicitCommittedFiles = runGit(repo, ['show', '--name-only', '--format=', 'HEAD']);
  assert.match(explicitCommittedFiles, /TASK-RECORD-0001\.note\.json/);
  assert.doesNotMatch(explicitCommittedFiles, /foreign-source\.ts/);
  assert.equal(runGit(repo, ['diff', '--cached', '--name-only']).trim(), '', 'record-only commit must leave no staged residue');
  let unsafePathError: unknown = null;
  try {
    await runAtmGit([
      'record-commit', '--cwd', repo, '--actor', 'record-actor',
      '--message', 'atm: unsafe path', '--paths', 'foreign-source.ts', '--dry-run', '--json'
    ]);
  } catch (error) {
    unsafePathError = error;
  }
  assert.ok(unsafePathError instanceof CliError);
  assert.equal((unsafePathError as CliError).code, 'ATM_GIT_RECORD_COMMIT_SCOPE_VIOLATION');

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
