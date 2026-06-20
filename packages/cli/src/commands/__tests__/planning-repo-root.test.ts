import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANNING_REPO_ROOT_ENV,
  isExternalPlanningStoredPath,
  readConfiguredPlanningRoots,
  resolveStoredPlanningPath,
  toStoredPlanningPath
} from '../planning-repo-root.ts';

describe('planning-repo-root', () => {
  it('stores external planning cards relative to the configured planning root', () => {
    const targetCwd = mkdtempSync(path.join(os.tmpdir(), 'aaf-target-'));
    const planningRoot = path.join(path.dirname(targetCwd), 'planning-repo', 'docs', 'ai_atomic_framework');
    const cardAbsolute = path.join(planningRoot, 'atm-agent-first-operability', 'tasks', 'TASK-AAO-0043.task.md');
    mkdirSync(path.dirname(cardAbsolute), { recursive: true });
    writeFileSync(cardAbsolute, '# card\n', 'utf8');
    mkdirSync(path.join(targetCwd, '.atm'), { recursive: true });
    writeFileSync(path.join(targetCwd, '.atm', 'config.json'), `${JSON.stringify({
      taskLedger: {
        planningRoots: ['../planning-repo/docs/ai_atomic_framework']
      }
    }, null, 2)}\n`, 'utf8');

    const stored = toStoredPlanningPath(targetCwd, cardAbsolute);
    assert.equal(stored, 'atm-agent-first-operability/tasks/TASK-AAO-0043.task.md');
    assert.equal(isExternalPlanningStoredPath(targetCwd, stored), true);
    assert.equal(resolveStoredPlanningPath(targetCwd, stored).absolutePath, cardAbsolute);

    rmSync(targetCwd, { recursive: true, force: true });
    rmSync(path.join(path.dirname(targetCwd), 'planning-repo'), { recursive: true, force: true });
  });

  it('reads configured planning roots from taskLedger config', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'aaf-config-'));
    mkdirSync(path.join(cwd, '.atm'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'config.json'), `${JSON.stringify({
      taskLedger: {
        planningRoots: ['../planning-repo/docs/ai_atomic_framework']
      }
    }, null, 2)}\n`, 'utf8');
    assert.deepEqual(readConfiguredPlanningRoots(cwd), ['../planning-repo/docs/ai_atomic_framework']);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('honors ATM_PLANNING_REPO_ROOT when resolving stored paths', () => {
    const targetCwd = mkdtempSync(path.join(os.tmpdir(), 'aaf-env-'));
    const planningRoot = path.join(targetCwd, 'external-planning');
    const cardAbsolute = path.join(planningRoot, 'tasks', 'TASK-X.task.md');
    mkdirSync(path.dirname(cardAbsolute), { recursive: true });
    writeFileSync(cardAbsolute, '# card\n', 'utf8');
    const previous = process.env[PLANNING_REPO_ROOT_ENV];
    process.env[PLANNING_REPO_ROOT_ENV] = planningRoot;
    try {
      const stored = toStoredPlanningPath(targetCwd, cardAbsolute);
      assert.equal(stored, 'tasks/TASK-X.task.md');
    } finally {
      if (previous === undefined) delete process.env[PLANNING_REPO_ROOT_ENV];
      else process.env[PLANNING_REPO_ROOT_ENV] = previous;
      rmSync(targetCwd, { recursive: true, force: true });
    }
  });
});
