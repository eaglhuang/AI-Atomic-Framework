/**
 * ATM-BUG-2026-07-29-270 — routing a task that belongs to an active batch.
 *
 * `next` reached the active-batch branch and threw `ReferenceError:
 * findActiveTaskQueue is not defined`, so every task enrolled in a live batch
 * answered `ATM_CLI_UNHANDLED` instead of a governed route. The helper was never
 * imported, and `// @ts-nocheck` at the top of the module kept `tsc` from
 * saying so.
 *
 * The regression therefore has two halves: the branch must resolve to a
 * structured next action, and the module must stay type-checked so the next
 * missing binding fails at build time rather than at a user's prompt.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildPromptScopedNextResult } from '../../packages/cli/src/commands/next/prompt-results.ts';

const moduleRelativePath = 'packages/cli/src/commands/next/prompt-results.ts';
const roots: string[] = [];

function createRepositoryWithActiveBatch(taskId: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-active-batch-route-'));
  roots.push(root);
  mkdirSync(path.join(root, '.atm', 'runtime'), { recursive: true });
  writeFileSync(
    path.join(root, '.atm', 'runtime', 'batch-run.json'),
    `${JSON.stringify({
      schemaId: 'atm.batchRun.v1',
      specVersion: '0.1.0',
      batchId: 'batch-fixture',
      scopeKey: 'tasks-fixture',
      queueId: 'queue-fixture',
      sourcePrompt: 'fixture batch prompt',
      targetRepo: 'AI-Atomic-Framework',
      taskIds: [taskId],
      currentIndex: 0,
      currentTaskId: taskId,
      commitMode: 'per-task',
      checkpointSize: 3,
      pendingCommitTaskId: null,
      status: 'active',
      createdByActor: 'fixture-actor',
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      skippedTasks: [],
      hold: null
    }, null, 2)}\n`,
    'utf8'
  );
  return root;
}

function fixtureTask(taskId: string) {
  return {
    workItemId: taskId,
    title: 'fixture task enrolled in an active batch',
    status: 'planned',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo',
    planningRepo: null,
    sourcePlanPath: null,
    taskPath: null,
    closedAt: null,
    closurePacket: null,
    targetAllowedFiles: [],
    scopePaths: [],
    deliverables: [],
    validators: []
  };
}

// --- the active-batch branch resolves instead of throwing ----------------

{
  const taskId = 'TASK-FIXTURE-0001';
  const root = createRepositoryWithActiveBatch(taskId);
  const task = fixtureTask(taskId);

  const result = buildPromptScopedNextResult({
    cwd: root,
    actor: 'fixture-actor',
    taskIntent: null,
    importedTaskQueue: {
      promptScope: { status: 'ready', selectedTasks: [task], targetRepo: 'AI-Atomic-Framework', diagnostics: [] },
      selectedTask: task,
      tasks: [task]
    } as never,
    integrationBootstrap: { ok: true } as never,
    runtimeAdapterReadiness: { ok: true } as never
  }) as { evidence?: { nextAction?: { status?: string; command?: string; reason?: string } } } | null;

  assert.ok(result, 'a task in an active batch must produce a route result');
  const nextAction = result.evidence?.nextAction;
  assert.ok(nextAction, 'the route must carry a next action rather than throwing');
  // Either answer is governed: continue through the batch head, or repair the
  // batch runtime first. What must never happen again is an unhandled throw.
  assert.ok(
    ['task-batch-context-active', 'batch-state-repair-required'].includes(String(nextAction.status)),
    `unexpected batch route status: ${nextAction.status}`
  );
  assert.match(String(nextAction.command), /^node atm\.mjs /, 'the route must hand back a runnable ATM command');
  assert.match(String(nextAction.reason), /batch/i);
}

// --- the module stays type-checked so bindings cannot silently vanish ----

{
  const source = readFileSync(moduleRelativePath, 'utf8');
  assert.ok(
    !/@ts-nocheck/.test(source),
    `${moduleRelativePath} must stay type-checked; @ts-nocheck is what hid the missing helper binding`
  );
  assert.match(
    source,
    /import \{ findActiveTaskQueue \} from '\.\.\/task-direction\.ts';/,
    'the active-batch branch calls findActiveTaskQueue, so the binding must be imported'
  );
}

for (const root of roots) rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ marker: '[next-active-batch-route:test] ok', bug: 'ATM-BUG-2026-07-29-270' }));
