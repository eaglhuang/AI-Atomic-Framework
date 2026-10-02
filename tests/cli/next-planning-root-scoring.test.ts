import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolvePromptScopedTaskRoute, scoreTaskForIntent } from '../../packages/cli/src/commands/next/route-resolution/matching.ts';
import { resolveCandidatePlanningRoots } from '../../packages/cli/src/commands/next/planning-root-preference.ts';
import type { TaskIntent } from '../../packages/cli/src/commands/next/intent-normalizers.ts';
import type { ImportedTaskSummary } from '../../packages/cli/src/commands/next/route-predicates.ts';

const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'atm-root-scoring-'));
const cwd = path.join(parent, 'repo');
const root = path.join(cwd, 'docs', 'ai_atomic_framework');
fs.mkdirSync(root, { recursive: true });
const intent: TaskIntent = {
  schemaId: 'atm.taskIntent.v1', userPrompt: 'task card optimize widget',
  explicitTaskIds: [], mentionedTaskIds: [], mentionedPlanPaths: [], taskRootHints: [],
  targetRepoHints: [], requestedAction: 'analyze', confidence: 1, source: 'cli-deterministic',
  ordinalScope: null, queueRequested: false, taskScopeMentioned: true
};
const tasks = Array.from({ length: 100 }, (_, index) => ({
  workItemId: `TASK-X-${index}`, title: 'optimize widget', status: 'open',
  taskPath: path.join(root, `task-${index}.task.md`), nearbyPlanPaths: [], dependencies: [],
  scopePaths: [], sourcePlanPath: null, targetRepo: null, format: 'markdown'
} as unknown as ImportedTaskSummary));
const originalReadDir = fs.readdirSync;
let scans = 0;
try {
  const expected = tasks.map(task => scoreTaskForIntent(cwd, task, intent));
  fs.readdirSync = ((...args: Parameters<typeof fs.readdirSync>) => {
    if (String(args[0]) === parent) scans++;
    return (originalReadDir as Function)(...args);
  }) as typeof fs.readdirSync;
  syncBuiltinESMExports();
  const actual = resolvePromptScopedTaskRoute(cwd, tasks, intent);
  assert.ok(actual);
  assert.equal(scans, 1, 'one planning-root discovery per scoring operation, not per task');
  for (const task of actual.selectedTasks) {
    const baseline = expected.find(entry => entry.workItemId === task.workItemId)!;
    assert.equal(task.matchScore, baseline.matchScore);
    assert.deepEqual(task.matchReasons, baseline.matchReasons);
  }
  scans = 0;
  const emptySnapshot = { roots: [], excludedDerivativeRoots: [], ambiguousSiblingGroups: [], warnings: [] };
  const withoutRoot = resolvePromptScopedTaskRoute(cwd, tasks, intent, emptySnapshot)!;
  assert.equal(scans, 0, 'consume a supplied snapshot without re-discovery');
  assert.ok(withoutRoot.selectedTasks.every(task => !task.matchReasons?.includes('canonical-planning-root')));
  const refreshed = resolvePromptScopedTaskRoute(cwd, tasks, intent)!;
  assert.equal(scans, 1, 'a later operation refreshes discovery; no global stale cache');
  assert.ok(refreshed.selectedTasks.every(task => task.matchReasons?.includes('canonical-planning-root')));
  const baselineMs: number[] = [];
  const optimizedMs: number[] = [];
  for (let run = 0; run < 12; run++) {
    let started = performance.now();
    for (const task of tasks) scoreTaskForIntent(cwd, task, intent);
    if (run > 1) baselineMs.push(performance.now() - started);
    started = performance.now();
    const roots = resolveCandidatePlanningRoots(cwd).roots;
    for (const task of tasks) scoreTaskForIntent(cwd, task, intent, roots);
    if (run > 1) optimizedMs.push(performance.now() - started);
  }
  const median = (samples: number[]) => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  console.log(JSON.stringify({
    benchmark: '100 task scoring; same process and fixture; warm-up excluded; alternating baseline/optimized',
    baselineMedianMs: median(baselineMs), optimizedMedianMs: median(optimizedMs),
    reductionPercent: Number(((1 - median(optimizedMs) / median(baselineMs)) * 100).toFixed(1)),
    baselinePlanningRootScans: 100, optimizedPlanningRootScans: 1
  }));
  console.log('next planning-root scoring: parity and operation-scoped discovery passed');
} finally {
  fs.readdirSync = originalReadDir;
  syncBuiltinESMExports();
  fs.rmSync(parent, { recursive: true, force: true });
}
