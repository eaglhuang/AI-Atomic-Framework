import assert from 'node:assert/strict';
import { parsePlanMarkdown } from '../../packages/cli/src/commands/tasks/plan-import-boundary.ts';

const parsed = parsePlanMarkdown({
  importedAt: '2026-07-19T00:00:00.000Z',
  planRelativePath: 'docs/plans/canonical-id-boundary.md',
  planText: [
    '# Governance plan',
    '',
    '## ATM-GOV-0182 Real complete heading',
    '',
    '- Deliverables: packages/cli/src/commands/tasks/plan-import-boundary.ts',
    '',
    '## TASK-ERR-0001 Error family still imports',
    '',
    '- Deliverables: scripts/validate-task-import.ts',
    '',
    '## TASK-TMP-0001 Tmp family still imports',
    '',
    '- Deliverables: tests/cli/task-import-canonical-id-boundary.test.ts',
    '',
    '### Reference-only examples',
    '',
    'These are prose references, not task declarations: ATM-GOV-0182..0190, TASK-ERR-0001..0003.',
    '',
    '### ATM-GOV-018x Reference template suffix must not become ATM-GOV-018',
    '',
    'This section documents a placeholder and should be reported as reference-only.',
    '',
    '### ATM-GOV-01820 Five digit family id still imports',
    '',
    'This section documents a complete five digit id.',
    '',
    '### ATM-GOV-018200 Six digits must not become ATM-GOV-01820',
    '',
    'This section documents an invalid suffix and should not emit a prefix fragment.',
    '',
    '```yaml',
    'dataDrivenDecision:',
    '  consumedSummaries:',
    '    - taskId: TASK-ID-0000',
    '      historyDigest: sha256:...',
    '```',
    '',
    '```markdown',
    '## TASK-EXAMPLE-0000 Example heading inside a code fence',
    '```'
  ].join('\n')
});

const ids = parsed.tasks.map((task) => task.workItemId);

assert.deepEqual(ids, ['ATM-GOV-0182', 'TASK-ERR-0001', 'TASK-TMP-0001', 'ATM-GOV-01820']);
assert.equal(ids.includes('ATM-GOV-018'), false);
assert.equal(ids.includes('ATM-GOV-0182'), true);
assert.equal(
  parsed.diagnostics.some((entry) => entry.code === 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT' && entry.workItemId === 'ATM-GOV-018'),
  true,
  'invalid heading fragment should be diagnosed as reference-only instead of imported'
);
assert.equal(
  parsed.diagnostics.some((entry) => entry.code === 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT' && entry.workItemId === 'ATM-GOV-018200'),
  true,
  'six digit heading should be diagnosed as reference-only instead of importing a five digit prefix'
);
assert.equal(ids.includes('TASK-ID-0000'), false);
assert.equal(ids.includes('TASK-EXAMPLE-0000'), false);
assert.equal(
  parsed.diagnostics.some((entry) => entry.code === 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT' && entry.workItemId === 'TASK-ID-0000'),
  true,
  'task-like yaml examples inside fenced code must be diagnosed as reference-only instead of imported'
);
assert.equal(
  parsed.diagnostics.some((entry) => entry.code === 'ATM_TASK_IMPORT_REFERENCE_ONLY_ID_FRAGMENT' && entry.workItemId === 'TASK-EXAMPLE-0000'),
  true,
  'task-like markdown headings inside fenced code must be diagnosed as reference-only instead of imported'
);

console.log('task-import-canonical-id-boundary.test passed');
