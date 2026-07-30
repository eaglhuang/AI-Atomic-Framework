import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasksImport } from '../../packages/cli/src/commands/tasks/import-orchestrator.ts';
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

const tempRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-task-import-diagnostic-contract-'));
const causalGraphCard = path.join(tempRepo, 'ATM-GOV-0276.task.md');
writeFileSync(causalGraphCard, [
  '---',
  'task_id: ATM-GOV-0276',
  'title: Preserve task import causal graph fidelity',
  'status: planned',
  'scopePaths:',
  '  - packages/cli/src/commands/tasks/import-orchestrator.ts',
  'deliverables:',
  '  - packages/cli/src/commands/tasks/import-orchestrator.ts',
  'validators:',
  '  - node --strip-types tests/cli/task-import-diagnostic-contract.test.ts',
  'testContributions:',
  '  - caseId: test_task_import_causal_graph_roundtrip_5f4a2d1c',
  '    coversAcceptance:',
  '      - ACC-1',
  '    coversImpactEdges:',
  '      - packages/cli/src/commands/tasks/import-orchestrator.ts -> tests/cli/task-import-diagnostic-contract.test.ts: causalGraph survives dry-run',
  '      - atm.string-edge.v1',
  '    responsibility: task-required',
  '    contractEdge: task-import-causal-graph-fidelity',
  'requiredTestCaseIds:',
  '  - test_task_import_causal_graph_roundtrip_5f4a2d1c',
  'phaseTestCaseIds:',
  '  - test_int_task_import_fidelity_1a2b3c4d',
  'advisoryTestCaseIds:',
  '  - test_advisory_task_import_fidelity_9e8d7c6b',
  'causalGraph:',
  '  causalDependencies:',
  '    - ATM-GOV-0274',
  '  startConditions:',
  '    - tasks import dry-run must carry frontmatter graph into the manifest',
  '  softRelations:',
  '    - ATM-GOV-0269',
  '  changedPublicSeams:',
  '    - atm.tasksImportFrontmatterContract.v1',
  '  causalImpactEdges:',
  '    - source: packages/cli/src/commands/tasks/import-orchestrator.ts',
  '      target: tests/cli/task-import-diagnostic-contract.test.ts',
  '      reason: causalGraph survives dry-run',
  '    - atm.string-edge.v1',
  '  parallelFrontierInputs:',
  '    - Claude-006 import dry-run receipt',
  '  validatorReferences:',
  '    - node --strip-types tests/cli/task-import-diagnostic-contract.test.ts',
  '  phaseOwner: import-fidelity',
  '---',
  '',
  '# ATM-GOV-0276',
  '',
  '## Acceptance',
  '',
  '- ACC-1 Preserve causalGraph fidelity.'
].join('\n'), 'utf8');

const causalGraphImport = await runTasksImport([
  '--cwd', tempRepo,
  '--from', causalGraphCard,
  '--dry-run',
  '--json'
]) as any;
assert.equal(causalGraphImport.ok, true, JSON.stringify(causalGraphImport.messages ?? causalGraphImport, null, 2));
const causalGraphTask = causalGraphImport.evidence.manifest.tasks[0];
assert.deepEqual(causalGraphTask.requiredTestCaseIds, ['test_task_import_causal_graph_roundtrip_5f4a2d1c']);
assert.deepEqual(causalGraphTask.phaseTestCaseIds, ['test_int_task_import_fidelity_1a2b3c4d']);
assert.deepEqual(causalGraphTask.advisoryTestCaseIds, ['test_advisory_task_import_fidelity_9e8d7c6b']);
assert.deepEqual(causalGraphTask.causalGraph.causalDependencies, ['ATM-GOV-0274']);
assert.deepEqual(causalGraphTask.causalGraph.startConditions, ['tasks import dry-run must carry frontmatter graph into the manifest']);
assert.deepEqual(causalGraphTask.causalGraph.softRelations, ['ATM-GOV-0269']);
assert.deepEqual(causalGraphTask.causalGraph.changedPublicSeams, ['atm.tasksImportFrontmatterContract.v1']);
assert.deepEqual(causalGraphTask.causalGraph.parallelFrontierInputs, ['Claude-006 import dry-run receipt']);
assert.deepEqual(causalGraphTask.causalGraph.validatorReferences, ['node --strip-types tests/cli/task-import-diagnostic-contract.test.ts']);
assert.equal(causalGraphTask.causalGraph.phaseOwner, 'import-fidelity');
assert.ok(
  causalGraphTask.causalGraph.causalImpactEdges.includes('atm.string-edge.v1'),
  'string causal impact edges must survive import dry-run'
);
assert.ok(
  causalGraphTask.causalGraph.causalImpactEdges.includes(
    'packages/cli/src/commands/tasks/import-orchestrator.ts -> tests/cli/task-import-diagnostic-contract.test.ts: causalGraph survives dry-run'
  ),
  'object causal impact edges must survive import dry-run as a deterministic edge string'
);

console.log('task-import-diagnostic-contract.test passed');
