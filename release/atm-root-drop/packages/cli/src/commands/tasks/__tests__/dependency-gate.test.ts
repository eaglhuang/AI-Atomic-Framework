import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
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

console.log('[dependency-gate.test] ok');
