import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasksClaimLifecycle } from '../../packages/cli/src/commands/tasks/claim-orchestrator.ts';
import { assertClaimDirtyWipAdmission, inspectClaimDirtyWipAdmission } from '../../packages/cli/src/commands/next/foreign-dirty-wip-admission.ts';
import { detectHistoricalDeliveryCommit } from '../../packages/cli/src/commands/tasks/historical-delivery.ts';

function fail(message: string): never {
  console.error(`[dirty-release-wip-recovery-0258.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function initRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-0258-wip-test-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Antigravity Test Agent'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'antigravity@atm.local'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeActorIdentity(repo: string, actorId: string, gitName = 'Test Agent', gitEmail = 'test@atm.local') {
  writeJson(path.join(repo, `.atm/runtime/identity/actors/${actorId}.json`), {
    schemaId: 'atm.actorIdentityProfile.v1',
    specVersion: '0.1.0',
    actorId,
    gitName,
    gitEmail,
    updatedAt: new Date().toISOString()
  });
}

function writeTracked(repo: string, relativePath: string, text = 'export const x = 1;\n') {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, 'utf8');
  execFileSync('git', ['add', relativePath], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', `add ${relativePath}`], { cwd: repo, stdio: 'ignore' });
}

const BUG_REF = 'ATM-BUG-2026-07-22-229';

async function runTests() {
  console.log(`[dirty-release-wip-recovery-0258.test] Running MVP tests for ATM-GOV-0258 (Ref: ${BUG_REF})...`);

  // Test 1: tasks release with dirty in-scope WIP must fail-close with ATM_RELEASE_DIRTY_WIP_BLOCKED
  {
    const repo = initRepo();
    try {
      writeActorIdentity(repo, 'test-actor-1');
      writeTracked(repo, 'packages/cli/src/test-feature.ts');
      writeJson(path.join(repo, '.atm/history/tasks/ATM-TEST-0001.json'), {
        schemaId: 'atm.taskDocument.v1',
        workItemId: 'ATM-TEST-0001',
        title: 'Test task 1',
        status: 'running',
        allowedFiles: ['packages/cli/src/test-feature.ts'],
        claim: {
          schemaId: 'atm.taskClaimRecord.v1',
          state: 'active',
          actorId: 'test-actor-1',
          leaseId: 'lease-test-1',
          claimedAt: new Date().toISOString(),
          files: ['packages/cli/src/test-feature.ts']
        }
      });
      // Make in-scope file dirty
      writeFileSync(path.join(repo, 'packages/cli/src/test-feature.ts'), 'export const x = 2; // dirty wip\n', 'utf8');

      try {
        await runTasksClaimLifecycle('release', [
          '--cwd', repo,
          '--task', 'ATM-TEST-0001',
          '--actor', 'test-actor-1',
          '--reason', 'Attempting plain release with dirty WIP'
        ]);
        fail('tasks release with dirty WIP must fail close');
      } catch (err: any) {
        assert(err.code === 'ATM_RELEASE_DIRTY_WIP_BLOCKED', `Expected ATM_RELEASE_DIRTY_WIP_BLOCKED but got ${err.code}`);
        assert(err.details.dirtyInScopeFiles.includes('packages/cli/src/test-feature.ts'), 'Dirty in-scope file must be reported');
        assert(typeof err.details.recoveryCommands.finishAndClose === 'string', 'finishAndClose recovery command must exist');
        assert(typeof err.details.recoveryCommands.nonDeliveryWipCommitAndRelease === 'string', 'nonDeliveryWipCommitAndRelease recovery command must exist');
        assert(typeof err.details.recoveryCommands.discardAndRelease === 'string', 'discardAndRelease recovery command must exist');
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Test 2: tasks release --wip-commit creates governed non-delivery WIP commit and releases claim
  {
    const repo = initRepo();
    try {
      writeActorIdentity(repo, 'test-actor-2');
      writeTracked(repo, 'packages/cli/src/test-feature.ts');
      writeJson(path.join(repo, '.atm/history/tasks/ATM-TEST-0002.json'), {
        schemaId: 'atm.taskDocument.v1',
        workItemId: 'ATM-TEST-0002',
        title: 'Test task 2',
        status: 'running',
        allowedFiles: ['packages/cli/src/test-feature.ts'],
        claim: {
          schemaId: 'atm.taskClaimRecord.v1',
          state: 'active',
          actorId: 'test-actor-2',
          leaseId: 'lease-test-2',
          claimedAt: new Date().toISOString(),
          files: ['packages/cli/src/test-feature.ts']
        }
      });
      writeFileSync(path.join(repo, 'packages/cli/src/test-feature.ts'), 'export const x = 99; // preserved wip\n', 'utf8');

      const releaseResult = await runTasksClaimLifecycle('release', [
        '--cwd', repo,
        '--task', 'ATM-TEST-0002',
        '--actor', 'test-actor-2',
        '--reason', 'Preserving WIP before release',
        '--wip-commit'
      ]);

      assert(releaseResult.ok, 'release --wip-commit must succeed');
      assert(Boolean(releaseResult.evidence.wipCommitReceipt), 'WIP commit receipt must be present in evidence');

      // Inspect HEAD commit message for WIP trailers
      const commitLog = execFileSync('git', ['log', '-n', '1', '--format=%B'], { cwd: repo, encoding: 'utf8' });
      assert(commitLog.includes('ATM-WIP: true'), 'Commit must contain ATM-WIP: true trailer');
      assert(commitLog.includes('ATM-Delivery: false'), 'Commit must contain ATM-Delivery: false trailer');
      assert(commitLog.includes('ATM-Closeout-Eligible: false'), 'Commit must contain ATM-Closeout-Eligible: false trailer');
      assert(commitLog.includes('ATM-Actor: test-actor-2'), 'Commit must contain ATM-Actor trailer');
      assert(commitLog.includes('ATM-Task: ATM-TEST-0002'), 'Commit must contain ATM-Task trailer');

      // Verify claim state updated to released
      const taskDoc = JSON.parse(readFileSync(path.join(repo, '.atm/history/tasks/ATM-TEST-0002.json'), 'utf8'));
      assert(taskDoc.claim.state === 'released', 'Task claim state must be released');

      // Verify detectHistoricalDeliveryCommit ignores the WIP commit SHA
      const wipSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
      const historicalDelivery = detectHistoricalDeliveryCommit({
        cwd: repo,
        taskId: 'ATM-TEST-0002',
        declaredFiles: ['packages/cli/src/test-feature.ts']
      });
      assert(historicalDelivery.commitSha !== wipSha, 'detectHistoricalDeliveryCommit must ignore non-delivery WIP commit SHA');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Test 3: tasks release --discard-wip creates discard receipt and restores working tree
  {
    const repo = initRepo();
    try {
      writeActorIdentity(repo, 'test-actor-3');
      writeTracked(repo, 'packages/cli/src/test-feature.ts', 'base line\n');
      writeJson(path.join(repo, '.atm/history/tasks/ATM-TEST-0003.json'), {
        schemaId: 'atm.taskDocument.v1',
        workItemId: 'ATM-TEST-0003',
        title: 'Test task 3',
        status: 'running',
        allowedFiles: ['packages/cli/src/test-feature.ts'],
        claim: {
          schemaId: 'atm.taskClaimRecord.v1',
          state: 'active',
          actorId: 'test-actor-3',
          leaseId: 'lease-test-3',
          claimedAt: new Date().toISOString(),
          files: ['packages/cli/src/test-feature.ts']
        }
      });
      writeFileSync(path.join(repo, 'packages/cli/src/test-feature.ts'), 'dirty to discard\n', 'utf8');

      const releaseResult = await runTasksClaimLifecycle('release', [
        '--cwd', repo,
        '--task', 'ATM-TEST-0003',
        '--actor', 'test-actor-3',
        '--reason', 'Discarding dirty WIP on release',
        '--discard-wip'
      ]);

      assert(releaseResult.ok, 'release --discard-wip must succeed');
      assert(Boolean(releaseResult.evidence.discardWipReceipt), 'Discard WIP receipt must be present in evidence');

      // Check evidence file created
      const receiptPath = path.join(repo, '.atm/history/evidence/ATM-TEST-0003.discard-wip-receipt.json');
      assert(existsSync(receiptPath), 'Discard receipt file must exist');

      // Check file content restored
      const restoredText = readFileSync(path.join(repo, 'packages/cli/src/test-feature.ts'), 'utf8');
      assert(restoredText.replace(/\r\n/g, '\n') === 'base line\n', 'Dirty file must be restored to clean base state');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Test 4: assertClaimDirtyWipAdmission includes recoveryCommands details when blocked
  {
    const repo = initRepo();
    try {
      writeTracked(repo, 'packages/cli/src/shared-target.ts');
      writeJson(path.join(repo, '.atm/history/tasks/TASK-FOREIGN.json'), {
        workItemId: 'TASK-FOREIGN',
        status: 'running',
        claim: {
          state: 'active',
          actorId: 'cursor-owner',
          leaseId: 'lease-foreign',
          files: ['packages/cli/src/shared-target.ts']
        }
      });
      writeFileSync(path.join(repo, 'packages/cli/src/shared-target.ts'), 'dirty foreign content\n', 'utf8');

      const candidate = {
        workItemId: 'TASK-CANDIDATE',
        title: 'candidate',
        status: 'ready',
        taskPath: '.atm/history/tasks/TASK-CANDIDATE.json'
      } as any;

      try {
        assertClaimDirtyWipAdmission({
          cwd: repo,
          task: candidate,
          actorId: 'claude-candidate',
          claimFiles: ['packages/cli/src/shared-target.ts']
        });
        fail('assertClaimDirtyWipAdmission must throw on foreign dirty WIP');
      } catch (err: any) {
        assert(err.code === 'ATM_CLAIM_FOREIGN_UNSTAGED_WIP', 'Error code must be ATM_CLAIM_FOREIGN_UNSTAGED_WIP');
        assert(Boolean(err.details.recoveryCommands), 'recoveryCommands must be present in details');
        assert(typeof err.details.recoveryCommands.nonDeliveryWipCommitAndRelease === 'string', 'nonDeliveryWipCommitAndRelease recovery command must be present');
        assert(err.details.recoveryCommands.nonDeliveryWipCommitAndRelease.includes('TASK-FOREIGN'), 'Recovery command must reference owner task');
        assert(err.details.recoveryCommands.nonDeliveryWipCommitAndRelease.includes('cursor-owner'), 'Recovery command must reference owner actor');
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  console.log('[dirty-release-wip-recovery-0258.test] All MVP tests passed successfully!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
