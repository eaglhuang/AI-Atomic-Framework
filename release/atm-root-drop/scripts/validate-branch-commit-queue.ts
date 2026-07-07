import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMissingSourceContractAnchors } from './lib/validator-envelope.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string): never {
  console.error(`[branch-commit-queue:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

const gitGovernanceSource = read('packages/cli/src/commands/git-governance.ts');
for (const detail of collectMissingSourceContractAnchors(gitGovernanceSource, [
  { token: 'ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', detail: 'git-governance must keep the branch queue busy retry code' },
  { token: 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE', detail: 'git-governance must keep the branch queue race retry code' },
  { token: "schemaId: 'atm.branchCommitQueueEvidence.v1'", detail: 'git-governance must emit branch commit queue evidence' },
  { token: 'function isHeadRaceCommitFailure', detail: 'git-governance must detect raw HEAD race failures explicitly' },
  { token: 'withBranchCommitQueueLock(', detail: 'git-governance must serialize final branch-tip mutation through the branch queue lock' },
  { token: 'ownerPid: process.pid', detail: 'branch queue locks must record ownerPid for stale self-heal evidence' },
  { token: 'ATM_BRANCH_COMMIT_QUEUE_STALE_SELF_HEALED', detail: 'branch queue lock self-heal must leave an explicit audit reason' },
  { token: 'branch-commit-queue-stale-cleanup.jsonl', detail: 'branch queue stale cleanup must write durable runtime audit evidence' },
  { token: 'record.actorId !== input.actorId', detail: 'branch queue stale self-heal must not clean cross-actor locks' }
])) {
  fail(detail);
}

const teamSource = read('packages/cli/src/commands/team.ts');
for (const detail of collectMissingSourceContractAnchors(teamSource, [
  {
    token: "retryableCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']",
    detail: 'team agent contract must advertise the queue retry codes'
  }
])) {
  fail(detail);
}

const closeGatesFocusedSource = read('packages/cli/src/commands/taskflow/__tests__/close-gates-focused.spec.ts');
for (const detail of collectMissingSourceContractAnchors(closeGatesFocusedSource, [
  {
    token: "branchQueueDryRun.evidence.writeReadinessHint.branchCommitQueueGate.status, 'busy'",
    detail: 'focused taskflow close gates regression must assert the branch queue busy verdict'
  },
  {
    token: 'ATM_TASKFLOW_CLOSE_BRANCH_COMMIT_QUEUE_BUSY',
    detail: 'focused taskflow close gates regression must assert the branch queue busy blocker code'
  }
])) {
  fail(detail);
}

const taskflowDryRunSource = read('packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts');
for (const detail of collectMissingSourceContractAnchors(taskflowDryRunSource, [
  {
    token: "branchQueueBusyDryRun.evidence.writeReadinessHint.branchCommitQueueGate.status, 'busy'",
    detail: 'taskflow dry-run regression must keep the branch queue busy gate'
  },
  {
    token: 'ATM_TASKFLOW_CLOSE_BRANCH_COMMIT_QUEUE_BUSY',
    detail: 'taskflow dry-run regression must keep the branch queue blocker code'
  }
])) {
  fail(detail);
}

console.log('[branch-commit-queue:validate] ok (branch queue busy/race guard and stale self-heal anchors verified)');
