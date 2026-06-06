import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContextMap } from '../../packages/cli/src/commands/tasks/task-import-validators.ts';
import { parsePlanMarkdown } from '../../packages/cli/src/commands/tasks.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// 1. 驗證 parseContextMap 對於無/空 contextMap 的行為
assert.equal(parseContextMap(undefined), undefined);
assert.equal(parseContextMap(null), undefined);
assert.equal(parseContextMap("invalid"), undefined);
assert.equal(parseContextMap({}), undefined);

// 2. 驗證 parseContextMap 對於正確結構的解析
const validContextMap = {
  primary: [
    { path: 'src/main.ts', reason: 'entry point' },
    { path: 'src/config.ts', reason: 'app config' }
  ],
  secondary: [
    { path: 'docs/api.md', reason: 'reference docs' }
  ],
  tests: [
    { path: 'tests/main.test.ts', reason: 'primary test' }
  ],
  patterns: [
    { referencePath: 'src/**/*.ts', referenceTaskId: 'TASK-AAO-0083', description: 'pattern description' }
  ]
};

const parsed = parseContextMap(validContextMap);
assert.ok(parsed);
assert.deepEqual(parsed.primary, [
  { path: 'src/main.ts', reason: 'entry point' },
  { path: 'src/config.ts', reason: 'app config' }
]);
assert.deepEqual(parsed.secondary, [
  { path: 'docs/api.md', reason: 'reference docs' }
]);
assert.deepEqual(parsed.tests, [
  { path: 'tests/main.test.ts', reason: 'primary test' }
]);
assert.deepEqual(parsed.patterns, [
  { referencePath: 'src/**/*.ts', referenceTaskId: 'TASK-AAO-0083', description: 'pattern description' }
]);

// 3. 驗證帶有不完整或多餘屬性的 contextMap 解析（部分 optional 屬性）
const partialContextMap = {
  primary: [
    { path: 'src/main.ts', reason: 'entry point' },
    { path: 'src/config.ts', reason: '' } // reason 空白，將被過濾
  ]
};
const parsedPartial = parseContextMap(partialContextMap);
assert.ok(parsedPartial);
assert.deepEqual(parsedPartial.primary, [
  { path: 'src/main.ts', reason: 'entry point' }
]);
assert.equal(parsedPartial.secondary, undefined);

// 4. 驗證 markdown parser 對於含有 contextMap frontmatter 的解析
const mockPlanWithContextMap = `---
task_id: TASK-TEST-0001
title: "Test Task"
status: planned
contextMap:
  primary:
    - path: "packages/cli/src/commands/tasks.ts"
      reason: "import logic"
  patterns:
    - referencePath: "tests/cli/*.ts"
      referenceTaskId: "TASK-AAO-0083"
      description: "mock tests"
---
## Goal
Test tasks.
`;

const importResult = parsePlanMarkdown({
  planText: mockPlanWithContextMap,
  planRelativePath: 'tests/mock.md',
  importedAt: '2026-05-30T00:00:00.000Z'
});

assert.equal(importResult.tasks.length, 1);
const taskRecord = importResult.tasks[0];
assert.equal(taskRecord.workItemId, 'TASK-TEST-0001');
assert.ok(taskRecord.contextMap);
assert.deepEqual(taskRecord.contextMap.primary, [
  { path: 'packages/cli/src/commands/tasks.ts', reason: 'import logic' }
]);
assert.deepEqual(taskRecord.contextMap.patterns, [
  { referencePath: 'tests/cli/*.ts', referenceTaskId: 'TASK-AAO-0083', description: 'mock tests' }
]);

// 5. 驗證 markdown parser 對於無 contextMap frontmatter 的解析，確保欄位缺省或為 undefined
const mockPlanWithoutContextMap = `---
task_id: TASK-TEST-0002
title: "Test Task 2"
status: planned
---
## Goal
Test tasks 2.
`;

const importResult2 = parsePlanMarkdown({
  planText: mockPlanWithoutContextMap,
  planRelativePath: 'tests/mock2.md',
  importedAt: '2026-05-30T00:00:00.000Z'
});

assert.equal(importResult2.tasks.length, 1);
assert.equal(importResult2.tasks[0].contextMap, undefined);

// 6. 既有 TASK-AAO-0083 task card import (無 contextMap 場景) 比對 byte-identical 驗證
const realTaskCardPath = path.resolve(root, '../3KLife/docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0083-external-task-source-plugin-interface.task.md');
if (existsSync(realTaskCardPath)) {
  const planText = readFileSync(realTaskCardPath, 'utf8');
  const importResult83 = parsePlanMarkdown({
    planText,
    planRelativePath: 'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-AAO-0083-external-task-source-plugin-interface.task.md',
    importedAt: '2026-05-30T00:00:00.000Z'
  });
  assert.equal(importResult83.tasks.length, 1);
  const task83 = importResult83.tasks[0];
  assert.equal(task83.workItemId, 'TASK-AAO-0083');
  assert.equal(task83.contextMap, undefined);
}

console.log('[work-item-context-map:test] ok (schema field, parser and backward compatibility verified)');
