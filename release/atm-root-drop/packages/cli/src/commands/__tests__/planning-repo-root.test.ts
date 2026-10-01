import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { partitionTaskScope } from '../task-direction/scope-policy.ts';
import { resolveTaskflowDeclaredFiles, resolveTaskflowEffectiveDeliverables } from '../taskflow/task-scope.ts';
import {
  PLANNING_REPO_ROOT_ENV,
  isExternalPlanningStoredPath,
  readConfiguredPlanningRoots,
  resolveStoredPlanningPath,
  toStoredPlanningPath
} from '../planning-repo-root.ts';

describe('planning-repo-root', () => {
  it('preserves mixed adopter scope through claim partition and close without widening a narrowed claim', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-adopter-close-scope-'));
    const previous = process.env[PLANNING_REPO_ROOT_ENV];
    delete process.env[PLANNING_REPO_ROOT_ENV];
    try {
      const taskId = 'TASK-NEWS-0002';
      const files = ['daily/issues/smoke.json', 'scripts/check-issue.mjs'];
      const partition = partitionTaskScope({ workItemId: taskId, title: 'Adopter scope',
        dependencies: [], taskPath: `.atm/history/tasks/${taskId}.json`, sourcePlanPath: null,
        nearbyPlanPaths: [], scopePaths: files, targetRepo: cwd, allowPlanningMirror: false }, { cwd });
      assert.deepEqual(partition.planningContext.readOnlyPaths, []);
      assert.deepEqual(partition.targetWork.allowedFiles, files);
      for (const narrowed of [false, true]) {
        const allowed = narrowed ? [files[0]] : files;
        const task = { scopePaths: files, deliverables: files,
          claim: { files: allowed }, taskDirectionLock: { allowedFiles: allowed, planningReadOnlyPaths: [] } };
        assert.deepEqual(resolveTaskflowDeclaredFiles(cwd, taskId, task), allowed);
        assert.deepEqual(resolveTaskflowEffectiveDeliverables(cwd, taskId, task), allowed);
      }
      const readOnlyTask = { scopePaths: files, deliverables: files, claim: { files },
        taskDirectionLock: { allowedFiles: files, planningReadOnlyPaths: [path.join(cwd, files[0])] } };
      assert.deepEqual(resolveTaskflowEffectiveDeliverables(cwd, taskId, readOnlyTask), [files[1]]);
    } finally {
      if (previous === undefined) delete process.env[PLANNING_REPO_ROOT_ENV];
      else process.env[PLANNING_REPO_ROOT_ENV] = previous;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps existing and planned adopter files local without framework directory allowlists', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'atm-adopter-local-'));
    const previous = process.env[PLANNING_REPO_ROOT_ENV];
    delete process.env[PLANNING_REPO_ROOT_ENV];
    try {
      for (const relative of ['daily/issues/smoke.json', 'app/main.ts', 'public/index.html', 'content/issue.json', 'data/items.json']) {
        const absolute = path.join(root, relative);
        for (const existing of [false, true]) {
          if (existing) {
            mkdirSync(path.dirname(absolute), { recursive: true });
            writeFileSync(absolute, '{}\n');
          }
          const resolved = resolveStoredPlanningPath(root, relative);
          assert.equal(resolved.absolutePath, absolute);
          assert.equal(resolved.isExternalPlanning, false, `${relative}, existing=${existing}`);
        }
      }
      assert.equal(resolveStoredPlanningPath(root, '../external/task.md').isExternalPlanning, true);
      assert.equal(resolveStoredPlanningPath(root, path.join(`${root}-other`, 'task.md')).isExternalPlanning, true);
    } finally {
      if (previous === undefined) delete process.env[PLANNING_REPO_ROOT_ENV];
      else process.env[PLANNING_REPO_ROOT_ENV] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers a concrete local adopter file over an external file with the same relative name', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'atm-planning-collision-'));
    const cwd = path.join(root, 'target');
    const planning = path.join(root, 'planning');
    const relative = 'daily/issues/smoke.json';
    const previous = process.env[PLANNING_REPO_ROOT_ENV];
    process.env[PLANNING_REPO_ROOT_ENV] = planning;
    try {
      for (const base of [cwd, planning]) {
        mkdirSync(path.dirname(path.join(base, relative)), { recursive: true });
        writeFileSync(path.join(base, relative), '{}\n');
      }
      const local = resolveStoredPlanningPath(cwd, relative);
      assert.equal(local.absolutePath, path.join(cwd, relative));
      assert.equal(local.isExternalPlanning, false);
      const external = resolveStoredPlanningPath(cwd, path.join(planning, relative));
      assert.equal(external.isExternalPlanning, true);
      assert.equal(external.absolutePath, path.join(planning, relative));
    } finally {
      if (previous === undefined) delete process.env[PLANNING_REPO_ROOT_ENV];
      else process.env[PLANNING_REPO_ROOT_ENV] = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  it('prefers an existing repo-local docs path over external planning roots', () => {
    const targetCwd = mkdtempSync(path.join(os.tmpdir(), 'aaf-local-docs-'));
    const planningRoot = path.join(path.dirname(targetCwd), 'planning-repo', 'docs', 'ai_atomic_framework');
    const localCardAbsolute = path.join(targetCwd, 'docs', 'ai_atomic_framework', 'atm-agent-first-operability', 'tasks', 'TASK-LOCAL.task.md');
    const externalCardAbsolute = path.join(planningRoot, 'atm-agent-first-operability', 'tasks', 'TASK-LOCAL.task.md');
    mkdirSync(path.dirname(localCardAbsolute), { recursive: true });
    mkdirSync(path.dirname(externalCardAbsolute), { recursive: true });
    writeFileSync(localCardAbsolute, '# local card\n', 'utf8');
    writeFileSync(externalCardAbsolute, '# external card\n', 'utf8');
    mkdirSync(path.join(targetCwd, '.atm'), { recursive: true });
    writeFileSync(path.join(targetCwd, '.atm', 'config.json'), `${JSON.stringify({
      taskLedger: {
        planningRoots: ['../planning-repo/docs/ai_atomic_framework']
      }
    }, null, 2)}\n`, 'utf8');

    const resolved = resolveStoredPlanningPath(
      targetCwd,
      'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-LOCAL.task.md'
    );
    assert.equal(resolved.absolutePath, localCardAbsolute);
    assert.equal(resolved.isExternalPlanning, false);

    rmSync(targetCwd, { recursive: true, force: true });
    rmSync(path.join(path.dirname(targetCwd), 'planning-repo'), { recursive: true, force: true });
  });
});
