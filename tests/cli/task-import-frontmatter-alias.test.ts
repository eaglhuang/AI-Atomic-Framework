import assert from 'node:assert/strict';
import { parsePlanMarkdown } from '../../packages/cli/src/commands/tasks/plan-import-boundary.ts';

const parse = (frontmatter: string) => parsePlanMarkdown({
  planText: `---\n${frontmatter}\nstatus: ready\nscopePaths:\n  - tools/acceptance.ts\ndeliverables:\n  - tools/acceptance.ts\n---\n# [PROG-2-0111] Acceptance\n`,
  planRelativePath: 'docs/tasks/card.md',
  importedAt: '2026-10-14T00:00:00.000Z'
});

for (const field of ['id', 'task_id']) {
  const result = parse(`${field}: PROG-2-0111`);
  assert.equal(result.tasks.length, 1, `${field} declares one task`);
  assert.equal(result.tasks[0].workItemId, 'PROG-2-0111');
  assert.deepEqual(result.tasks[0].scopePaths, ['tools/acceptance.ts']);
  assert.deepEqual(result.tasks[0].deliverables, ['tools/acceptance.ts']);
}
assert.equal(parse('id: doc_ai_0018').tasks.length, 0, 'document ids are not task declarations');
assert.equal(parse('id: PROG-2-0111x').tasks.length, 0, 'partial identifiers are rejected');
assert.equal(parse('task_id: TASK-ERR-0001\nid: PROG-2-0111').tasks[0].workItemId, 'TASK-ERR-0001', 'canonical field takes precedence');
console.log('task-import-frontmatter-alias.test passed');
