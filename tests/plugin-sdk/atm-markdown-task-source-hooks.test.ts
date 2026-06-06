import assert from 'node:assert/strict';
import plugin from '../../packages/atm-markdown-task-source/src/index.ts';

// (a) validate 對含 contextMap 的卡 ok
const mockParsedOk = {
  taskId: 'TASK-AAO-8888',
  frontmatter: {
    task_id: 'TASK-AAO-8888',
    title: 'Valid Task',
    status: 'planned',
    deliverables: ['src/main.ts'],
    contextMap: {
      primary: [{ path: 'src/main.ts', reason: 'valid reason' }]
    }
  },
  sourcePath: 'tasks/TASK-AAO-8888.task.md'
};

const validationResultOk = await plugin.validate!(mockParsedOk);
assert.ok(validationResultOk.ok);
// 沒有任何警告/錯誤
assert.equal(validationResultOk.diagnostics.length, 0);

// (b) validate 對缺 contextMap.primary 的卡發 warning
const mockParsedWarning = {
  taskId: 'TASK-AAO-8888',
  frontmatter: {
    task_id: 'TASK-AAO-8888',
    title: 'Invalid Task',
    status: 'planned',
    deliverables: []
  },
  sourcePath: 'tasks/TASK-AAO-8888.task.md'
};

const validationResultWarning = await plugin.validate!(mockParsedWarning);
assert.ok(validationResultWarning.ok); // 依然 ok = true (advisory mode)
const hasPrimaryWarning = validationResultWarning.diagnostics.some(d => d.code === 'ATM_VALIDATION_MISSING_PRIMARY_CONTEXT');
const hasDeliverablesWarning = validationResultWarning.diagnostics.some(d => d.code === 'ATM_VALIDATION_MISSING_DELIVERABLES');
assert.ok(hasPrimaryWarning);
assert.ok(hasDeliverablesWarning);

// (c) generate 套 intent 後產出合法 task card，並可被 parse hook 反向解析
const intent = {
  cwd: process.cwd(),
  templateKey: 'aao-l2-split',
  fields: {
    task_id: 'TASK-AAO-9999',
    title: 'Round-trip Validation',
    depends_on: 'TASK-AAO-0085',
    scope_path: 'packages/cli/src/commands/tasks.ts',
    test_path: 'tests/cli/tasks-new.test.ts',
    atom_id: 'atm.markdown-task-source-plugin',
    capability: 'Template generation and round-trip parse support',
    goal: 'Ensure new task templates can be completely parsed back by standard plugin.',
    sourcePath: 'tasks/TASK-AAO-9999.task.md'
  }
};

const generated = await plugin.generate!(intent);
assert.equal(generated.taskId, 'TASK-AAO-9999');
assert.ok(generated.content);

// 進行反向解析 (Round-trip)
const parsedBack = await plugin.parse!({
  cwd: process.cwd(),
  sourcePath: generated.sourcePath,
  raw: generated.content
});

assert.ok(parsedBack);
assert.equal(parsedBack.taskId, 'TASK-AAO-9999');
assert.equal(parsedBack.frontmatter.task_id, 'TASK-AAO-9999');
assert.equal(parsedBack.frontmatter.title, 'Round-trip Validation');
assert.ok(parsedBack.frontmatter.contextMap);

console.log('[plugin-hooks:test] ok (validate, generate, and round-trip parse verified)');
