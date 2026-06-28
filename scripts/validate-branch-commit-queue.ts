import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
assert(gitGovernanceSource.includes('ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY'), 'git-governance must keep the branch queue busy retry code');
assert(gitGovernanceSource.includes('ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'), 'git-governance must keep the branch queue race retry code');
assert(gitGovernanceSource.includes("schemaId: 'atm.branchCommitQueueEvidence.v1'"), 'git-governance must emit branch commit queue evidence');
assert(gitGovernanceSource.includes('function isHeadRaceCommitFailure'), 'git-governance must detect raw HEAD race failures explicitly');
assert(gitGovernanceSource.includes('withBranchCommitQueueLock('), 'git-governance must serialize final branch-tip mutation through the branch queue lock');

const teamSource = read('packages/cli/src/commands/team.ts');
assert(teamSource.includes("retryableCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']"), 'team agent contract must advertise the queue retry codes');

const closeGatesFocusedSource = read('packages/cli/src/commands/taskflow/__tests__/close-gates-focused.spec.ts');
assert(closeGatesFocusedSource.includes("branchQueueDryRun.evidence.writeReadinessHint.branchCommitQueueGate.status, 'busy'"), 'focused taskflow close gates regression must assert the branch queue busy verdict');
assert(closeGatesFocusedSource.includes("ATM_TASKFLOW_CLOSE_BRANCH_COMMIT_QUEUE_BUSY"), 'focused taskflow close gates regression must assert the branch queue busy blocker code');

const taskflowDryRunSource = read('packages/cli/src/commands/taskflow/__tests__/taskflow-dryrun.spec.ts');
assert(taskflowDryRunSource.includes("branchQueueBusyDryRun.evidence.writeReadinessHint.branchCommitQueueGate.status, 'busy'"), 'taskflow dry-run regression must keep the branch queue busy gate');
assert(taskflowDryRunSource.includes("ATM_TASKFLOW_CLOSE_BRANCH_COMMIT_QUEUE_BUSY"), 'taskflow dry-run regression must keep the branch queue blocker code');

console.log('[branch-commit-queue:validate] ok (branch queue busy/race guard and regression anchors verified)');
