import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectActiveTaskDivergence } from '../../packages/cli/src/commands/next/playbook-projection/task-routing.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-active-task-planning-root-'));
try {
  const taskId = 'TASK-PLANNING-0001';
  const planPath = path.join(root, 'planning', 'docs', 'plan.md');
  const unrelatedPlanPath = path.join(root, 'planning', 'docs', 'other-plan.md');
  const taskDir = path.join(root, '.atm', 'history', 'tasks');
  mkdirSync(path.dirname(planPath), { recursive: true });
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(planPath, '# active plan\n', 'utf8');
  mkdirSync(path.dirname(unrelatedPlanPath), { recursive: true });
  writeFileSync(unrelatedPlanPath, '# unrelated plan\n', 'utf8');
  writeFileSync(path.join(taskDir, `${taskId}.json`), `${JSON.stringify({
    workItemId: taskId,
    status: 'running',
    claim: { state: 'active', actorId: 'captain-a', files: ['packages/cli/src'] },
    scopePaths: ['packages/cli/src'],
    source: { planPath },
    planningRepo: root
  }, null, 2)}\n`, 'utf8');

  const baseIntent = { mentionedTaskIds: [], explicitTaskIds: [] } as any;
  const queue = { promptScope: null } as any;
  assert.equal(
    detectActiveTaskDivergence(root, { ...baseIntent, userPrompt: `continue work from ${planPath}` }, queue),
    null,
    'the active task planning root is continuation context, not divergence'
  );
  assert.ok(
    detectActiveTaskDivergence(root, { ...baseIntent, userPrompt: `continue work from ${unrelatedPlanPath}` }, queue),
    'an unrelated external plan must remain divergence'
  );
  console.log('[active-task-planning-root-continuation.test] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
