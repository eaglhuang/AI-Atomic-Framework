import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HARD_CAUSAL_DEPENDENCY_SEMANTICS,
  areTaskDependenciesSatisfied,
  findTaskClaimDependencyBlockers
} from '../dependency-gate.ts';

function fail(message: string): never {
  console.error(`[dependency-gate.test] ${message}`);
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

function writeTask(repo: string, taskId: string, document: Record<string, unknown>) {
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    ...document
  });
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-dependency-gate-'));

writeTask(repo, 'TASK-DEP-PLANNED', { status: 'planned' });
let blockers = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', {
  status: 'ready',
  dependencies: ['TASK-DEP-PLANNED']
}, {
  claimFiles: ['packages/cli/src/commands/tasks/dependency-gate.ts']
});
assert(blockers.length === 1, 'planned dependency must block claim');
assert(blockers[0]?.status === 'planned', 'planned dependency blocker must preserve normalized status');
assert(blockers[0]?.blockedByDependency === true, 'dependency blocker must expose blockedByDependency');
assert(blockers[0]?.dependencyTaskIds?.includes('TASK-DEP-PLANNED'), 'dependency blocker must expose dependencyTaskIds');
assert(blockers[0]?.scopeClass?.hasCode === true, 'code claim blocker must expose scopeClass');
assert(blockers[0]?.codeFilesBlocked?.includes('packages/cli/src/commands/tasks/dependency-gate.ts'), 'code claim blocker must identify code files');
assert(blockers[0]?.allowedDependencyBlockedRoute === 'docs-ledger-planning', 'blocker must identify the still-allowed planning route');

blockers = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', {
  status: 'ready',
  dependencies: ['TASK-DEP-PLANNED']
}, {
  claimFiles: ['docs/governance/plan.md', '.atm/history/tasks/TASK-CONSUMER.json']
});
assert(blockers.length === 0, 'docs and ledger only claim must bypass unresolved dependency gate');

writeTask(repo, 'TASK-DEP-MANUAL-DONE', { status: 'done' });
blockers = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', {
  status: 'ready',
  dependencies: ['TASK-DEP-MANUAL-DONE']
}, {
  claimFiles: ['scripts/validate-task.ts']
});
assert(blockers.length === 1, 'source-done dependency without closeout provenance must block claim');
assert(blockers[0]?.status === 'source-done-governance-incomplete', 'manual done blocker must use governed closeout bucket');
assert(String(blockers[0]?.requiredCommand).includes('tasks repair-closure'), 'manual done blocker must point to repair-closure recovery');

writeJson(path.join(repo, '.atm', 'history', 'evidence', 'TASK-DEP-CLOSED.closure-packet.json'), {
  schemaId: 'atm.closurePacket.v1',
  taskId: 'TASK-DEP-CLOSED'
});
writeTask(repo, 'TASK-DEP-CLOSED', {
  status: 'done',
  closurePacket: '.atm/history/evidence/TASK-DEP-CLOSED.closure-packet.json'
});
blockers = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', {
  status: 'ready',
  dependencies: ['TASK-DEP-CLOSED']
}, {
  claimFiles: ['packages/core/src/index.ts']
});
assert(blockers.length === 0, 'dependency with governed closeout provenance must not block claim');

const statusById = new Map<string, string>([
  ['TASK-DEP-MANUAL-DONE', 'done'],
  ['TASK-DEP-CLOSED', 'done']
]);
assert(
  !areTaskDependenciesSatisfied({ workItemId: 'TASK-CONSUMER', dependencies: ['TASK-DEP-MANUAL-DONE'] }, statusById, repo),
  'next dependency eligibility must reject source-done without governed closeout provenance'
);
assert(
  areTaskDependenciesSatisfied({ workItemId: 'TASK-CONSUMER', dependencies: ['TASK-DEP-CLOSED'] }, statusById, repo),
  'next dependency eligibility must accept governed closeout provenance'
);

writeTask(repo, 'TASK-DEP-PLANNING-AUTHORITY', {
  status: 'done',
  closureAuthority: 'planning_repo'
});
assert(
  areTaskDependenciesSatisfied({ workItemId: 'TASK-CONSUMER', dependencies: ['TASK-DEP-PLANNING-AUTHORITY'] }, new Map([['TASK-DEP-PLANNING-AUTHORITY', 'done']]), repo),
  'planning_repo authority dependencies must remain exempt from target closure packet enforcement'
);

/**
 * ATM-GOV-0406 — the claim half of the Plan 4.1 hard-causal contract.
 *
 * The cases above pin legacy behavior, which must not move until a family is
 * audited. The cases below pin what opting in buys: a freeze costs six proven
 * facts, and everything short of that stays claimable.
 */

function completeProof(producerOutput: string, overrides: Record<string, unknown> = {}) {
  return {
    producerOutput,
    consumerOperation: 'atm.tasks.claim',
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
      command: 'node --strip-types packages/cli/src/commands/tasks/__tests__/dependency-gate.test.ts',
      blocksBeforeProducerOutput: true,
      admitsAfterProducerOutput: true
    },
    ...overrides
  };
}

function typedConsumer(dependencies: readonly unknown[]) {
  return {
    status: 'ready',
    dependencySemantics: HARD_CAUSAL_DEPENDENCY_SEMANTICS,
    dependencies: [...dependencies]
  };
}

const CODE_CLAIM_FILES = ['packages/cli/src/commands/tasks/dependency-gate.ts'];

// caseId: test_gov_nonhard_claim_admission_0406
// None of the five non-hard relations may freeze a claim, and neither may a
// file or atom overlap. Overlap reaches the Broker at the write boundary; it is
// not a whole-task dependency, so the lane starts.
{
  writeTask(repo, 'TASK-DEP-OPEN-0406', { status: 'planned' });
  for (const relation of ['validation', 'publication', 'observation', 'soft-order', 'file-overlap', 'atom-overlap'] as const) {
    const nonHard = findTaskClaimDependencyBlockers(
      repo,
      'TASK-CONSUMER-0406',
      typedConsumer([{ taskId: 'TASK-DEP-OPEN-0406', relation }]),
      { claimFiles: CODE_CLAIM_FILES }
    );
    assert(nonHard.length === 0, `${relation} must not block a code claim`);
  }
}

// caseId: test_gov_hard_causal_contract_0406
// The executable negative control, at the claim boundary. The same declaration
// blocks while the producer output is unsealed and admits once it exists, so
// the gate is answered by a result rather than by a status word.
{
  const producerOutput = 'docs/reports/atm-gov-0406-negative-control.json';
  const document = typedConsumer([
    { taskId: 'TASK-DEP-OPEN-0406', relation: 'hard-causal', hardCausalProof: completeProof(producerOutput) }
  ]);
  const before = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER-0406', document, { claimFiles: CODE_CLAIM_FILES });
  assert(before.length === 1, 'a proven hard-causal edge must block before its producer output is sealed');
  assert(before[0]?.status === 'hard-causal-producer-output-pending', 'the refusal must name the pending producer output');
  assert(before[0]?.relation === 'hard-causal', 'the refusal must report the relation it acted on');
  assert(
    before[0]?.requiredCommand?.includes('dependency-gate.test.ts'),
    'the refusal must hand back the declared negative control as its recovery command'
  );

  writeJson(path.join(repo, producerOutput), { sealed: true });
  const after = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER-0406', document, { claimFiles: CODE_CLAIM_FILES });
  assert(after.length === 0, 'the same declaration must admit once the sealed producer output exists');
}

// caseId: test_gov_hard_causal_contract_0406
// An edge that claims to be hard-causal without proving it fails closed. Import
// refuses such a declaration, so one reaching a live ledger means the record was
// written outside the contract and its meaning is unknown.
{
  const unprovable = findTaskClaimDependencyBlockers(
    repo,
    'TASK-CONSUMER-0406',
    typedConsumer([
      {
        taskId: 'TASK-DEP-OPEN-0406',
        relation: 'hard-causal',
        hardCausalProof: completeProof('docs/reports/atm-gov-0406-absent.json', { resultUndefinedWithoutOutput: false })
      }
    ]),
    { claimFiles: CODE_CLAIM_FILES }
  );
  assert(unprovable.length === 1, 'a contradicted hard-causal edge must fail closed at claim');
  assert(unprovable[0]?.status === 'hard-causal-proof-unprovable', 'the refusal must say the proof is unprovable, not that the producer is pending');
}

// caseId: test_gov_legacy_boundary_0406
// An opted-in card cannot fall back to an untyped dependency, and a card that
// never opted in keeps the legacy status gate exactly as the cases above pinned
// it. Neither direction changes silently.
{
  const fallback = findTaskClaimDependencyBlockers(
    repo,
    'TASK-CONSUMER-0406',
    typedConsumer(['TASK-DEP-OPEN-0406']),
    { claimFiles: CODE_CLAIM_FILES }
  );
  assert(fallback.length === 1, 'an opted-in card must not silently accept an untyped dependency at claim');
  assert(fallback[0]?.relation === 'legacy-untyped', 'the refusal must name the untyped edge');

  const legacy = findTaskClaimDependencyBlockers(
    repo,
    'TASK-CONSUMER-0406',
    { status: 'ready', dependencies: ['TASK-DEP-OPEN-0406'] },
    { claimFiles: CODE_CLAIM_FILES }
  );
  assert(legacy.length === 1, 'an unaudited legacy card must keep the legacy status gate');
  assert(legacy[0]?.status === 'planned', 'legacy blockers must keep reporting the dependency status');
}

console.log('[dependency-gate.test] ok');
