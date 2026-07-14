import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inspectPlanningRootAuthorship,
  isPlanningFamilyTaskId,
  isTargetTaskPlanPath
} from '../planning-root-authorship.ts';

assert.equal(isTargetTaskPlanPath('.atm/task-plans/TASK-AAO-0190.md'), true);
assert.equal(isTargetTaskPlanPath('docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0190.task.md'), false);
assert.equal(isPlanningFamilyTaskId('TASK-AAO-0190'), true);
assert.equal(isPlanningFamilyTaskId('TASK-TEAM-0001'), true);
assert.equal(isPlanningFamilyTaskId('TASK-GIT-0015'), false);

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-planning-root-authorship-'));
try {
  const planningRoot = path.join(tempRoot, 'planning-repo', 'docs', 'ai_atomic_framework');
  const tasksDir = path.join(planningRoot, 'atm-agent-first-operability', 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(path.join(tasksDir, 'TASK-AAO-0190-sample.task.md'), '# TASK-AAO-0190\n', 'utf8');

  const missing = inspectPlanningRootAuthorship({
    cwd: path.join(tempRoot, 'AI-Atomic-Framework'),
    planAbsolute: path.join(tempRoot, 'AI-Atomic-Framework', '.atm', 'task-plans', 'TASK-AAO-0193.md'),
    planRelativePath: '.atm/task-plans/TASK-AAO-0193.md',
    taskIds: ['TASK-AAO-0193'],
    isFrameworkRepo: true,
    planningRoots: [planningRoot]
  });
  assert.equal(missing.applies, true);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'ATM_TASKS_IMPORT_PLANNING_ROOT_REQUIRED');
  assert.deepEqual(missing.missingTaskIds, ['TASK-AAO-0193']);
  assert.ok(String(missing.requiredCommand).includes('docs/ai_atomic_framework'));

  const present = inspectPlanningRootAuthorship({
    cwd: path.join(tempRoot, 'AI-Atomic-Framework'),
    planAbsolute: path.join(tempRoot, 'AI-Atomic-Framework', '.atm', 'task-plans', 'TASK-AAO-0190.md'),
    planRelativePath: '.atm/task-plans/TASK-AAO-0190.md',
    taskIds: ['TASK-AAO-0190'],
    isFrameworkRepo: true,
    planningRoots: [planningRoot]
  });
  assert.equal(present.applies, true);
  assert.equal(present.ok, true);
  assert.equal(present.code, null);
  assert.ok(present.findings[0]?.foundCardPath?.includes('TASK-AAO-0190-sample.task.md'));

  const waived = inspectPlanningRootAuthorship({
    cwd: path.join(tempRoot, 'AI-Atomic-Framework'),
    planAbsolute: path.join(tempRoot, 'AI-Atomic-Framework', '.atm', 'task-plans', 'TASK-AAO-0193.md'),
    planRelativePath: '.atm/task-plans/TASK-AAO-0193.md',
    taskIds: ['TASK-AAO-0193'],
    isFrameworkRepo: true,
    planningRoots: [planningRoot],
    waivePlanningRoot: true
  });
  assert.equal(waived.applies, true);
  assert.equal(waived.ok, true);
  assert.equal(waived.waived, true);

  const nonFramework = inspectPlanningRootAuthorship({
    cwd: path.join(tempRoot, 'adopter'),
    planAbsolute: path.join(tempRoot, 'adopter', '.atm', 'task-plans', 'TASK-AAO-0193.md'),
    planRelativePath: '.atm/task-plans/TASK-AAO-0193.md',
    taskIds: ['TASK-AAO-0193'],
    isFrameworkRepo: false,
    planningRoots: [planningRoot]
  });
  assert.equal(nonFramework.applies, false);
  assert.equal(nonFramework.ok, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[planning-root-authorship.spec] ok');
