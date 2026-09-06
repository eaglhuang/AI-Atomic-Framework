/**
 * ATM-BUG-2026-08-09-007 — a queue route without an active batch must not
 * prescribe a repair command that is guaranteed to fail with RUN_MISSING.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildPromptScopeQueueResult } from '../../packages/cli/src/commands/next/prompt-result-contracts.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-batch-repair-route-'));
try {
  const task = {
    workItemId: 'TASK-FIXTURE-007',
    title: 'fixture queue task',
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
  const result = buildPromptScopeQueueResult({
    cwd: root,
    actor: 'fixture-actor',
    taskIntent: null,
    importedTaskQueue: {
      promptScope: { status: 'ready', selectedTasks: [task], targetRepo: 'AI-Atomic-Framework', diagnostics: [] },
      selectedTask: task,
      tasks: [task]
    } as never,
    selectedTasks: [task] as never,
    queueHeadTask: task as never,
    integrationBootstrap: { ok: true } as never,
    runtimeAdapterReadiness: { ok: true } as never
  }) as { evidence?: { nextAction?: { command?: string; status?: string } } };

  const nextAction = result.evidence?.nextAction;
  assert.ok(nextAction, 'queue route must return a structured next action');
  assert.notEqual(nextAction.status, 'batch-state-repair-required');
  assert.doesNotMatch(String(nextAction.command), /batch repair/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('[batch-repair-route-no-active-batch.test] ok');
