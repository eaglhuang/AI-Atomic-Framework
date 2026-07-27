import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildPreCommitBlockingFindings,
  buildPreCommitFailureEnvelope,
  buildPreCommitRepairHints,
  inspectProtectedAtmStateChanges,
  isPreCommitBaselineFinding,
  isPreCommitEnvironmentFinding,
  isUnconsumedCloseWindowDeferralSnapshot,
  runPreCommitHook,
  selectActionableResidueFindings,
  summarizePreCommitFailureEnvelope
} from '../../packages/cli/src/commands/hook/pre-commit.ts';

const maxLines = 600;
const checkedModules = [
  'packages/cli/src/commands/hook/pre-commit.ts',
  'packages/cli/src/commands/hook/pre-commit/cross-file-consistency.ts',
  'packages/cli/src/commands/hook/pre-commit/failure-envelope.ts',
  'packages/cli/src/commands/hook/pre-commit/implementation.ts',
  'packages/cli/src/commands/hook/pre-commit/input-state.ts',
  'packages/cli/src/commands/hook/pre-commit/scope-ownership.ts',
  'packages/cli/src/commands/hook/pre-commit/support.ts',
  'tests/cli/pre-commit-hook-extraction.test.ts'
];

for (const file of checkedModules) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const lineCount = lines.length;
  const longestLine = Math.max(...lines.map((line) => line.length));
  assert.ok(lineCount <= maxLines, `${file} should stay at or below ${maxLines} lines, saw ${lineCount}`);
  assert.ok(longestLine <= 1000, `${file} should not hide a large module in one long line, saw ${longestLine} chars`);
}

const facade = readFileSync('packages/cli/src/commands/hook/pre-commit.ts', 'utf8').trim();
assert.match(facade, /export \* from '\.\/pre-commit\/implementation\.ts';/);

assert.equal(typeof runPreCommitHook, 'function');
assert.equal(typeof buildPreCommitBlockingFindings, 'function');
assert.equal(typeof buildPreCommitFailureEnvelope, 'function');
assert.equal(typeof buildPreCommitRepairHints, 'function');
assert.equal(typeof summarizePreCommitFailureEnvelope, 'function');
assert.equal(typeof selectActionableResidueFindings, 'function');
assert.equal(typeof inspectProtectedAtmStateChanges, 'function');
assert.equal(typeof isUnconsumedCloseWindowDeferralSnapshot, 'function');
assert.equal(typeof isPreCommitBaselineFinding, 'function');
assert.equal(typeof isPreCommitEnvironmentFinding, 'function');

// ---------------------------------------------------------------------------
// ATM-GOV-0266 hook parity: the pre-commit hook consumes the same block-lifecycle
// classifier as `git record-commit`. A governed record-commit — proven by a
// single-use, content-bound authorization artifact referenced through the commit
// environment — may persist exactly one blocked/released card's ledger + its
// matching block event through an active framework claim. A raw `git commit` of
// an identical pair, or any ineligible/tampered payload, stays blocked with
// ATM_CROSS_TASK_MUTATION_BLOCKED.
// ---------------------------------------------------------------------------
{
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const os = (await import('node:os')).default;
  const path = (await import('node:path')).default;
  const { CliError } = await import('../../packages/cli/src/commands/shared.ts');
  const { detectCrossTaskMutation } = await import('../../packages/core/src/broker/cross-task-mutation-guard.ts');
  const { authorizeBlockLifecycleRecordBridge } = await import('../../packages/cli/src/commands/hook/pre-commit/implementation.ts');
  const { RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR, RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV } = await import(
    '../../packages/cli/src/commands/git-governance/record-only-block-lifecycle-bridge.ts'
  );

  const TASK = 'TASK-SKL-0029';
  const ACTOR = 'claude-004-skl-0029-captain';
  const LEASE = 'lease-2bc3d4b0df0c';
  const LEDGER_REL = `.atm/history/tasks/${TASK}.json`;
  const EVENT_REL = `.atm/history/task-events/${TASK}/2026-07-27T08-48-46-260Z-block-f249ae664692.json`;

  const git = (cwd: string, args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const writeJson = (root: string, rel: string, value: unknown) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  };
  const sha256File = (root: string, rel: string) =>
    createHash('sha256').update(readFileSync(path.join(root, rel))).digest('hex');

  const stagePair = (root: string) => {
    writeJson(root, LEDGER_REL, {
      schemaVersion: 'atm.workItem.v0.2', workItemId: TASK, status: 'blocked', title: 'Parked card',
      claim: { actorId: ACTOR, leaseId: LEASE, state: 'released' }
    });
    writeJson(root, EVENT_REL, {
      schemaId: 'atm.taskTransition.v1', taskId: TASK, action: 'block', actorId: ACTOR,
      fromStatus: 'running', toStatus: 'blocked', taskPath: LEDGER_REL
    });
    git(root, ['add', LEDGER_REL, EVENT_REL]);
  };
  const writeAuth = (root: string, nonce: string, over: Record<string, unknown> = {}) => {
    const dir = path.join(root, RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR);
    mkdirSync(dir, { recursive: true });
    const auth = {
      nonce, actorId: ACTOR, taskId: TASK, exemptPaths: [EVENT_REL, LEDGER_REL].sort(),
      ledgerPath: LEDGER_REL, ledgerSha256: sha256File(root, LEDGER_REL),
      eventPath: EVENT_REL, eventSha256: sha256File(root, EVENT_REL),
      createdAtMs: Date.now(), ttlMs: 120_000, ...over
    };
    writeFileSync(path.join(dir, `${nonce}.json`), `${JSON.stringify(auth, null, 2)}\n`, 'utf8');
  };
  const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
    const prev: Record<string, string | undefined> = {};
    for (const key of Object.keys(vars)) prev[key] = process.env[key];
    try {
      for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fn();
    } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-precommit-parity-'));
  try {
    git(repo, ['init']);
    git(repo, ['config', 'user.name', 'ATM Validator']);
    git(repo, ['config', 'user.email', 'validator@example.invalid']);
    git(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);

    stagePair(repo);
    const block = detectCrossTaskMutation(repo, null, 'pre-commit');
    assert.ok(block, 'expected a cross-task block for the staged pair');
    assert.equal(block!.conflictTaskId, TASK);

    // 1. Raw git (no authorization) → not authorized.
    withEnv({ [RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV]: undefined, ATM_COMMIT_ACTOR_ID: undefined }, () => {
      assert.equal(authorizeBlockLifecycleRecordBridge(repo, block!).authorized, false);
    });

    // 2. Governed record-commit context: valid content-bound authorization → authorized.
    writeAuth(repo, 'nonce-eligible');
    withEnv({ [RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV]: 'nonce-eligible', ATM_COMMIT_ACTOR_ID: ACTOR }, () => {
      const verdict = authorizeBlockLifecycleRecordBridge(repo, block!);
      assert.equal(verdict.authorized, true, `expected authorized: ${verdict.reason}`);
    });

    withEnv({ [RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV]: 'nonce-eligible', ATM_COMMIT_ACTOR_ID: ACTOR, ATM_COMMIT_TASK_ID: undefined }, () => {
      assert.doesNotThrow(() => runPreCommitHook(repo));
    });

    // 3. Tampered staged content after the artifact → digest mismatch → blocked.
    withEnv({ [RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV]: 'nonce-eligible', ATM_COMMIT_ACTOR_ID: ACTOR }, () => {
      writeJson(repo, LEDGER_REL, {
        schemaVersion: 'atm.workItem.v0.2', workItemId: TASK, status: 'blocked', title: 'tampered',
        claim: { actorId: ACTOR, leaseId: LEASE, state: 'released' }
      });
      git(repo, ['add', LEDGER_REL]);
      assert.equal(authorizeBlockLifecycleRecordBridge(repo, block!).authorized, false);
    });

    // 4. The actual pre-commit hook blocks a raw commit of the pair (no authorization).
    stagePair(repo);
    withEnv({ [RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV]: undefined, ATM_COMMIT_ACTOR_ID: undefined, ATM_COMMIT_TASK_ID: undefined }, () => {
      let caught: unknown = null;
      try { runPreCommitHook(repo); } catch (error) { caught = error; }
      assert.ok(caught instanceof CliError, `expected the hook to block raw git, got ${String(caught)}`);
      assert.equal((caught as InstanceType<typeof CliError>).code, 'ATM_CROSS_TASK_MUTATION_BLOCKED');
    });

    // 5. Ineligible payload (extra evidence record) stays blocked even with an env nonce.
    const evidenceRel = `.atm/history/evidence/${TASK}.runner-sync-receipt.json`;
    writeJson(repo, evidenceRel, { taskId: TASK, note: 'extra record' });
    git(repo, ['add', evidenceRel]);
    const ineligibleBlock = detectCrossTaskMutation(repo, null, 'pre-commit');
    assert.ok(ineligibleBlock);
    writeAuth(repo, 'nonce-ineligible');
    withEnv({ [RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV]: 'nonce-ineligible', ATM_COMMIT_ACTOR_ID: ACTOR }, () => {
      assert.equal(authorizeBlockLifecycleRecordBridge(repo, ineligibleBlock!).authorized, false);
    });

    console.log('pre-commit-hook-extraction.test.ts: hook parity assertions passed');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}
