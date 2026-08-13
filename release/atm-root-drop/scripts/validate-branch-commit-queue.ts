import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMissingSourceContractAnchors } from './lib/validator-envelope.ts';
import { collectMissingContractAnchors, resolveValidatorContractSubject } from './lib/validator-contract-subject.ts';

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

// ATM-GOV-0354: assert against the surface that owns branch-queue behaviour, not
// against two frozen paths. The implementation has since been split under
// git-governance/implementation/**, and pinning the subject made a legitimate
// refactor look like a deleted contract.
const gitGovernanceSubject = resolveValidatorContractSubject(root, [
  'packages/cli/src/commands/git-governance.ts',
  'packages/cli/src/commands/git-governance'
]);
const gitGovernanceSource = gitGovernanceSubject.text;
for (const detail of collectMissingContractAnchors(gitGovernanceSubject, [
  { token: 'ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', detail: 'git-governance must keep the branch queue busy retry code' },
  { token: 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE', detail: 'git-governance must keep the branch queue race retry code' },
  // Quote style is formatter-owned; the contract is that this schema id is emitted here.
  { pattern: /schemaId:\s*['"]atm\.branchCommitQueueEvidence\.v1['"]/, detail: 'git-governance must emit branch commit queue evidence' },
  { token: 'function isHeadRaceCommitFailure', detail: 'git-governance must detect raw HEAD race failures explicitly' },
  { token: 'withBranchCommitQueueLock(', detail: 'git-governance must serialize final branch-tip mutation through the branch queue lock' },
  { token: 'ownerPid: process.pid', detail: 'branch queue locks must record ownerPid for stale self-heal evidence' },
  { token: 'ATM_BRANCH_COMMIT_QUEUE_STALE_SELF_HEALED', detail: 'branch queue lock self-heal must leave an explicit audit reason' },
  { token: 'branch-commit-queue-stale-cleanup.jsonl', detail: 'branch queue stale cleanup must write durable runtime audit evidence' },
  // ATM-GOV-0354 / ATM-BUG-2026-08-13-001 adjudication: commit 6301d9386
  // ("fix(git): recover dead branch commit queues") deliberately removed both the
  // cross-actor guard and the headMoved requirement, because an orphan lock left
  // by a crashed peer could otherwise deadlock the queue forever with HEAD
  // unmoved. Reclamation is now bounded by provable owner death plus staleness,
  // with a durable audit naming the reclaiming actor. Anchor that bound instead
  // of the retired one — the protection was replaced, not lost.
  { token: 'isBranchCommitQueueOwnerAlive(record.ownerPid)', detail: 'branch queue stale self-heal must gate on provable owner death' },
  { token: 'ownerAlive === false || ownerAlive === null', detail: 'branch queue stale self-heal must treat only a dead or unknown owner as reclaimable' },
  { token: 'ageMs >= branchCommitQueueStaleSelfHealMs', detail: 'branch queue stale self-heal must require a staleness threshold, not just a dead owner' },
  { token: 'actorId: input.actorId', detail: 'branch queue stale cleanup audit must record the reclaiming actor' }
])) {
  fail(detail);
}

const teamSource = [
  read('packages/cli/src/commands/team.ts'),
  read('packages/cli/src/commands/team/legacy/runtime-governance.ts'),
  read('packages/cli/src/commands/team/legacy/types.ts')
].join('\n');
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

console.log('[branch-commit-queue:validate] ok (branch queue busy/race guard and stale self-heal anchors verified)');
