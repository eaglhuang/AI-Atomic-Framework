import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectProtectedAtmStateChanges } from '../../packages/cli/src/commands/hook.ts';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';
import {
  findCaseInsensitiveRelativePath,
  normalizeTaskId,
  taskIdsEqual
} from '../../packages/cli/src/commands/tasks/task-import-validators.ts';

const mixedCaseTaskId = 'TASK-APO-0030-python-language-adapter-plugin';
const legacyUpperTaskId = 'TASK-ASP-0001';

// === normalizeTaskId preserves authored casing ===
assert.equal(normalizeTaskId(`  ${mixedCaseTaskId}  `), mixedCaseTaskId);
assert.equal(normalizeTaskId(`\`${legacyUpperTaskId}\``), legacyUpperTaskId);
assert.equal(normalizeTaskId(mixedCaseTaskId), mixedCaseTaskId);
assert.notEqual(normalizeTaskId(mixedCaseTaskId), mixedCaseTaskId.toUpperCase());

// === taskIdsEqual folds case only for comparison ===
assert.ok(taskIdsEqual(mixedCaseTaskId, mixedCaseTaskId.toUpperCase()));
assert.ok(taskIdsEqual(legacyUpperTaskId, legacyUpperTaskId));
assert.ok(!taskIdsEqual('TASK-AAO-0139', 'TASK-AAO-0140'));

// === import writes mixed-case workItemId to ledger ===
const importRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-aao139-import-'));
try {
  mkdirSync(path.join(importRoot, '.atm', 'history', 'tasks'), { recursive: true });
  const cardPath = path.join(importRoot, 'TASK-APO-0030-python-language-adapter-plugin.task.md');
  writeFileSync(cardPath, `---
task_id: ${mixedCaseTaskId}
title: Mixed-case import regression
status: open
milestone: M-test
---

# Mixed-case import regression

## Acceptance Criteria

- [ ] placeholder
`, 'utf8');

  const importResult = await runTasks([
    'import',
    '--cwd', importRoot,
    '--from', cardPath,
    '--write',
    '--json'
  ]);
  assert.ok(importResult.ok, 'tasks import should succeed');

  const ledgerPath = path.join(importRoot, '.atm', 'history', 'tasks', `${mixedCaseTaskId}.json`);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as { workItemId?: string };
  assert.equal(ledger.workItemId, mixedCaseTaskId, 'import must preserve authored task_id casing');
} finally {
  rmSync(importRoot, { recursive: true, force: true });
}

// === close verification identity: casing-only queue/ledger mismatch must match ===
assert.ok(
  taskIdsEqual(mixedCaseTaskId.toUpperCase(), mixedCaseTaskId),
  'verifyPersistedTaskDocument uses taskIdsEqual for identity checks'
);

// === hook transition pairing tolerates event-directory casing skew ===
const hookRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-aao139-hook-'));
try {
  const transitionId = '2026-06-10T12-00-00-000Z-close-test';
  const ledgerRelative = `.atm/history/tasks/${mixedCaseTaskId}.json`;
  const eventDirLower = `.atm/history/task-events/${mixedCaseTaskId.toLowerCase()}`;
  const eventRelative = `${eventDirLower}/${transitionId}.json`;

  mkdirSync(path.join(hookRoot, path.dirname(ledgerRelative)), { recursive: true });
  mkdirSync(path.join(hookRoot, eventDirLower), { recursive: true });

  writeFileSync(path.join(hookRoot, ledgerRelative), JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: mixedCaseTaskId,
    status: 'done',
    lastTransitionId: transitionId
  }, null, 2), 'utf8');

  writeFileSync(path.join(hookRoot, eventRelative), JSON.stringify({
    schemaId: 'atm.taskTransition.v1',
    transitionId,
    taskId: mixedCaseTaskId,
    taskPath: ledgerRelative,
    taskSha256: 'sha256:deadbeef',
    command: 'node atm.mjs tasks close --task TASK-APO-0030 --json'
  }, null, 2), 'utf8');

  const stagedPaths = [ledgerRelative, eventRelative];
  assert.equal(
    findCaseInsensitiveRelativePath(stagedPaths, `.atm/history/task-events/${mixedCaseTaskId}/${transitionId}.json`),
    eventRelative,
    'case-insensitive staged path lookup should find the lower-cased event directory'
  );

  const report = inspectProtectedAtmStateChanges(hookRoot, stagedPaths);
  const missingTransition = report.findings.filter((entry) => entry.reason === 'task-file-missing-transition');
  assert.equal(missingTransition.length, 0, `expected no missing-transition findings, got ${JSON.stringify(missingTransition)}`);
} finally {
  rmSync(hookRoot, { recursive: true, force: true });
}

console.log('TASK-AAO-0139 task-id casing regression tests: PASS');
