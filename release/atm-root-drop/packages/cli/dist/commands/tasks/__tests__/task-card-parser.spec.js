import assert from 'node:assert/strict';
import { parsePlanMarkdown } from '../../../../../atm-markdown-task-source/dist/task-card-parser.js';
const parsed = parsePlanMarkdown({
    importedAt: '2026-07-10T00:00:00.000Z',
    planRelativePath: 'docs/tasks/TASK-RFT-0019.task.md',
    planText: `---
task_id: TASK-RFT-0019
title: Parser parity
status: planned
scopePaths:
  - packages/cli/src/commands/tasks.ts
deliverables:
  - packages/cli/src/commands/tasks.ts
validators:
  - npm run typecheck
planningArtifacts:
  - docs/blueprints/TASK-RFT-0019.md
---

## Acceptance
- Parse single-card markdown.
`
});
assert.equal(parsed.diagnostics.length, 0);
assert.equal(parsed.tasks.length, 1);
assert.equal(parsed.tasks[0].workItemId, 'TASK-RFT-0019');
assert.deepEqual(parsed.tasks[0].scopePaths, ['packages/cli/src/commands/tasks.ts']);
assert.deepEqual(parsed.tasks[0].deliverables, ['packages/cli/src/commands/tasks.ts']);
assert.deepEqual(parsed.tasks[0].planningArtifacts, ['docs/blueprints/TASK-RFT-0019.md']);
console.log('task-card-parser.spec passed');
