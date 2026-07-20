import assert from 'node:assert/strict';
import { parsePlanMarkdown } from '../../packages/cli/src/commands/tasks/plan-import-boundary.ts';

const parsed = parsePlanMarkdown({
  importedAt: '2026-07-20T00:00:00.000Z',
  planRelativePath: 'docs/plans/task-import-diagnostic-contract.md',
  planText: [
    '# Parser diagnostic fixture',
    '',
    'This document intentionally has no real task headings.',
    '',
    '```bash',
    '# TASK-ERR-0099 shell comment inside a fenced code block',
    'echo "still not a task card"',
    '```',
    '',
    'A prose reference to TASK-ERR-0098 is also not a declaration.'
  ].join('\n')
});

assert.deepEqual(parsed.tasks.map((task) => task.workItemId), []);

const fencedDiagnostic = parsed.diagnostics.find((entry) =>
  entry.code === 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT'
  && entry.workItemId === 'TASK-ERR-0099'
);

assert(fencedDiagnostic, 'fenced shell-style task id must be diagnosed instead of imported');
assert.equal(fencedDiagnostic.sourceLine, 6, 'diagnostic must point at the fenced triggering line');
assert.match(fencedDiagnostic.text, /fenced code blocks/i);

console.log('task-import-diagnostic-contract.test passed');
