import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTaskClaimDependencyBlockers } from '../../packages/cli/src/commands/tasks/dependency-gate.ts';

function fail(message: string): never {
  console.error(`[prompt-scoped-next-claim-dependency-scope.test] ${message}`);
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

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-next-claim-dependency-scope-'));

try {
  writeTask(repo, 'TASK-UPSTREAM', { status: 'planned' });
  const consumer = { status: 'ready', dependencies: ['TASK-UPSTREAM'] };

  const docsOnly = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', consumer, {
    claimFiles: ['docs/blueprint.md', '.atm/history/tasks/TASK-CONSUMER.json']
  });
  assert(docsOnly.length === 0, 'unresolved dependencies must allow docs and ledger claim files');

  const mixed = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', consumer, {
    claimFiles: ['docs/blueprint.md', 'packages/cli/src/commands/next/claim-orchestration.ts']
  });
  assert(mixed.length === 1, 'unresolved dependencies must block when any code file is claimed');
  assert(mixed[0]?.codeFilesBlocked?.length === 1, 'mixed claim blocker must list only the code files');
  assert(mixed[0]?.scopeClass?.scopeClass.includes('docs'), 'mixed claim blocker must retain docs scope evidence');
  assert(mixed[0]?.scopeClass?.scopeClass.includes('code'), 'mixed claim blocker must retain code scope evidence');

  writeJson(path.join(repo, '.atm', 'history', 'evidence', 'TASK-UPSTREAM.closure-packet.json'), {
    schemaId: 'atm.closurePacket.v1',
    taskId: 'TASK-UPSTREAM'
  });
  writeTask(repo, 'TASK-UPSTREAM', {
    status: 'done',
    closurePacket: '.atm/history/evidence/TASK-UPSTREAM.closure-packet.json'
  });
  const afterClose = findTaskClaimDependencyBlockers(repo, 'TASK-CONSUMER', consumer, {
    claimFiles: ['packages/cli/src/commands/next/claim-orchestration.ts']
  });
  assert(afterClose.length === 0, 'code claim must be admitted after dependency closeout provenance exists');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[prompt-scoped-next-claim-dependency-scope.test] ok');
