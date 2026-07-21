import assert from 'node:assert/strict';
import { parsePlanMarkdown } from '../../packages/cli/src/commands/tasks/plan-import-boundary.ts';
import { collectFencedCodeLines } from '../../packages/cli/src/commands/tasks/task-import-diagnostics.ts';

assert.deepEqual(
  [...collectFencedCodeLines(['before', '~~~sh', '# TASK-ERR-0101', '~~~', 'after'].join('\n'))],
  [2, 3, 4],
  'diagnostics helper must mark tilde fenced lines before heading-like token attribution'
);

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
    '~~~sh',
    '# TASK-ERR-0100 tilde fence comment inside a fenced code block',
    '~~~',
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

const tildeDiagnostic = parsed.diagnostics.find((entry) =>
  entry.code === 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT'
  && entry.workItemId === 'TASK-ERR-0100'
);

assert(tildeDiagnostic, 'tilde fenced shell-style task id must be diagnosed instead of imported');
assert.equal(tildeDiagnostic.sourceLine, 11, 'tilde diagnostic must point at the fenced triggering line');
assert.match(tildeDiagnostic.text, /fenced code blocks/i);

console.log('task-import-diagnostic-contract.test passed');
