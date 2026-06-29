import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  diagnoseClaimReadinessForTasks,
  type ClaimReadinessTaskSummary
} from '../../next.ts';

function fail(message: string): never {
  console.error(`[claim-readiness.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-claim-readiness-'));

try {
  const taskSummaries: ClaimReadinessTaskSummary[] = [
    {
      workItemId: 'TASK-MARKDOWN',
      status: 'open',
      format: 'markdown',
      sourcePlanPath: 'docs/tasks/TASK-MARKDOWN.task.md'
    },
    {
      workItemId: 'TASK-REVIEW',
      status: 'review',
      format: 'json',
      sourcePlanPath: null
    },
    {
      workItemId: 'TASK-BLOCKED-BY-DEP',
      status: 'ready',
      format: 'json',
      sourcePlanPath: null
    },
    {
      workItemId: 'TASK-READY',
      status: 'ready',
      format: 'json',
      sourcePlanPath: null
    }
  ];

  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-BLOCKED-BY-DEP.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-BLOCKED-BY-DEP',
    status: 'ready',
    dependencies: ['TASK-UPSTREAM']
  });
  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-UPSTREAM.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-UPSTREAM',
    status: 'done'
  });

  const writeLane = diagnoseClaimReadinessForTasks(repo, taskSummaries, 'write');
  assert(writeLane.primaryBlocker?.taskId === 'TASK-MARKDOWN', 'markdown import requirement must be the first blocker');
  assert(writeLane.primaryBlocker?.blockerCode === 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED', 'markdown tasks must explain import requirement');

  const reviewLane = diagnoseClaimReadinessForTasks(repo, [taskSummaries[1]], 'write');
  assert(reviewLane.primaryBlocker?.blockerCode === 'ATM_NEXT_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED', 'review tasks must require closeout-only on write intent');
  assert(String(reviewLane.primaryBlocker?.requiredCommand).includes('--claim-intent closeout-only'), 'review blocker must include closeout-only recovery command');

  const dependencyLane = diagnoseClaimReadinessForTasks(repo, [taskSummaries[2]], 'write');
  assert(dependencyLane.primaryBlocker?.blockerCode === 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED', 'dependency gaps must surface as claim blockers');
  assert(dependencyLane.primaryBlocker?.dependencyBlockers[0]?.taskId === 'TASK-UPSTREAM', 'dependency blocker must identify the upstream task');

  const readyLane = diagnoseClaimReadinessForTasks(repo, [taskSummaries[3]], 'write');
  assert(readyLane.primaryBlocker === null, 'ready task must not report a blocking readiness issue');
  assert(readyLane.diagnostics[0]?.claimable === true, 'ready task must be marked claimable');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[claim-readiness.test] ok');
