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
const documentPlan = parsePlanMarkdown({
  planText: '---\nid: doc_ai_0018\n---\n# TASK-PLAN-0001 Real task heading\n',
  planRelativePath: 'docs/plan.md',
  importedAt: '2026-10-14T00:00:00.000Z'
});
assert.equal(documentPlan.tasks[0]?.workItemId, 'TASK-PLAN-0001', 'document ids must not hide real task headings');
console.log('task-import-frontmatter-alias.test passed');
