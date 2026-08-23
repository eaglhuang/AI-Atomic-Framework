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
      sourcePlanPath: null,
      scopePaths: ['packages/cli/src/commands/tasks/dependency-gate.ts']
    },
    {
      workItemId: 'TASK-DOCS-BY-DEP',
      status: 'ready',
      format: 'json',
      sourcePlanPath: null,
      scopePaths: ['docs/planning.md', '.atm/history/tasks/TASK-DOCS-BY-DEP.json']
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
  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-DOCS-BY-DEP.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-DOCS-BY-DEP',
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
  assert(dependencyLane.primaryBlocker?.dependencyBlockers[0]?.codeFilesBlocked?.includes('packages/cli/src/commands/tasks/dependency-gate.ts'), 'dependency blocker must identify blocking code files');

  const docsLane = diagnoseClaimReadinessForTasks(repo, [taskSummaries[3]], 'write');
  assert(docsLane.primaryBlocker === null, 'docs-only task must not be dependency-blocked while upstream closeout is incomplete');

  const readyLane = diagnoseClaimReadinessForTasks(repo, [taskSummaries[4]], 'write');
  assert(readyLane.primaryBlocker === null, 'ready task must not report a blocking readiness issue');
  assert(readyLane.diagnostics[0]?.claimable === true, 'ready task must be marked claimable');

  /**
   * ATM-GOV-0406 — typed dependency semantics at the claim-readiness surface.
   *
   * Two cards differ only in the relation they declare about the same upstream
   * task. One starts, one waits. That difference is the whole point of the
   * contract, so it is asserted here rather than only at the gate below.
   */
  const upstreamOutput = 'docs/reports/atm-gov-0406-claim-readiness-output.json';
  const hardCausalProof = {
    producerOutput: upstreamOutput,
    consumerOperation: 'atm.next.claim',
    outputValueChangesConsumerResult: true,
    substitutesAvailable: {
      stableInterface: false,
      fixture: false,
      proposalFirst: false,
      lateBinding: false,
      deferredCompose: false
    },
    resultUndefinedWithoutOutput: true,
    negativeControl: {
      command: 'node --strip-types packages/cli/src/commands/next/__tests__/claim-readiness.test.ts',
      blocksBeforeProducerOutput: true,
      admitsAfterProducerOutput: true
    }
  };

  // caseId: test_gov_nonhard_claim_admission_0406
  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-TYPED-SOFT.json'), {
    workItemId: 'TASK-TYPED-SOFT',
    status: 'ready',
    dependencySemantics: 'hard-causal/v1',
    dependencies: [{ taskId: 'TASK-UPSTREAM', relation: 'soft-order' }]
  });
  const softLane = diagnoseClaimReadinessForTasks(repo, [{
    workItemId: 'TASK-TYPED-SOFT',
    status: 'ready',
    format: 'json',
    sourcePlanPath: null,
    scopePaths: ['packages/cli/src/commands/tasks/dependency-gate.ts']
  }], 'write');
  assert(softLane.primaryBlocker === null, 'a soft-order relation must not block a code claim');

  // caseId: test_gov_hard_causal_contract_0406
  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-TYPED-HARD.json'), {
    workItemId: 'TASK-TYPED-HARD',
    status: 'ready',
    dependencySemantics: 'hard-causal/v1',
    dependencies: [{ taskId: 'TASK-UPSTREAM', relation: 'hard-causal', hardCausalProof }]
  });
  const hardSummary: ClaimReadinessTaskSummary = {
    workItemId: 'TASK-TYPED-HARD',
    status: 'ready',
    format: 'json',
    sourcePlanPath: null,
    scopePaths: ['packages/cli/src/commands/tasks/dependency-gate.ts']
  };
  const hardLane = diagnoseClaimReadinessForTasks(repo, [hardSummary], 'write');
  assert(hardLane.primaryBlocker?.blockerCode === 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED', 'a proven hard-causal edge must block the claim');
  assert(
    String(hardLane.primaryBlocker?.blockerSummary).includes(upstreamOutput),
    'the refusal must name the producer output the claim is actually waiting on'
  );

  writeJson(path.join(repo, upstreamOutput), { sealed: true });
  const hardLaneAfter = diagnoseClaimReadinessForTasks(repo, [hardSummary], 'write');
  assert(hardLaneAfter.primaryBlocker === null, 'the same card must become claimable once the producer output is sealed');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[claim-readiness.test] ok');
