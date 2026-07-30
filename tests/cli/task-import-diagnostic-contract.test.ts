import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

// `--write` must carry the same declarations the dry-run manifest reported.
// A ledger record that is thinner than the dry-run preview is the failure shape
// this validator exists to prevent.
mkdirSync(path.join(tempRepo, '.atm/history/tasks'), { recursive: true });
mkdirSync(path.join(tempRepo, '.atm/history/evidence'), { recursive: true });
writeFileSync(path.join(tempRepo, '.atm/config.json'), JSON.stringify({}, null, 2), 'utf8');

const causalGraphWrite = await runTasksImport([
  '--cwd', tempRepo,
  '--from', causalGraphCard,
  '--write',
  '--json'
]) as any;
assert.equal(causalGraphWrite.ok, true, JSON.stringify(causalGraphWrite.messages ?? causalGraphWrite, null, 2));

const writtenLedger = JSON.parse(
  readFileSync(path.join(tempRepo, '.atm/history/tasks/ATM-GOV-0276.json'), 'utf8')
) as Record<string, any>;
assert.deepEqual(
  writtenLedger.causalGraph,
  causalGraphTask.causalGraph,
  'tasks import --write must persist the same causalGraph the dry-run manifest reported'
);
assert.deepEqual(writtenLedger.requiredTestCaseIds, causalGraphTask.requiredTestCaseIds);
assert.deepEqual(writtenLedger.phaseTestCaseIds, causalGraphTask.phaseTestCaseIds);
assert.deepEqual(writtenLedger.advisoryTestCaseIds, causalGraphTask.advisoryTestCaseIds);
assert.equal(
  writtenLedger.testContributions.length,
  causalGraphTask.testContributions.length,
  'exam-contract test contributions must survive the write path'
);
assert.equal(writtenLedger.frontmatterFidelity.ok, true);
assert.ok(
  writtenLedger.frontmatterFidelity.checkedFields.includes('causalGraph.softRelations'),
  'the fidelity report must record which declarations were actually checked'
);

// ── Fail-closed on unrepresentable governance metadata ─────────────────────
// A card may declare sealed governance metadata that no import contract knows
// how to carry. Import must refuse rather than write a reduced ledger record.
const unrepresentableCard = path.join(tempRepo, 'TASK-FID-0001.task.md');
writeFileSync(unrepresentableCard, [
  '---',
  'task_id: TASK-FID-0001',
  'title: Unrepresentable exam authority metadata',
  'status: planned',
  'scopePaths:',
  '  - packages/cli/src/commands/tasks/import-orchestrator.ts',
  'deliverables:',
  '  - packages/cli/src/commands/tasks/import-orchestrator.ts',
  'validators:',
  '  - npm run typecheck',
  'examAuthorityRefs:',
  '  - exam-authority://sealed-contract',
  '---',
  '',
  '# TASK-FID-0001',
  '',
  '## Acceptance',
  '',
  '- ACC-1 Fail closed instead of dropping sealed governance metadata.'
].join('\n'), 'utf8');

for (const mode of ['--dry-run', '--write']) {
  await assert.rejects(
    () => runTasksImport(['--cwd', tempRepo, '--from', unrepresentableCard, mode, '--json']),
    (err: any) => {
      const fidelityDiagnostics = (err.details?.diagnostics ?? []).filter((entry: any) =>
        entry.code === 'ATM_TASK_IMPORT_FRONTMATTER_FIDELITY_LOSS');
      assert.ok(
        fidelityDiagnostics.length > 0,
        `tasks import ${mode} must fail closed with a fidelity diagnostic, got ${JSON.stringify(err.details?.diagnostics ?? err.message)}`
      );
      assert.equal(fidelityDiagnostics[0].level, 'error');
      assert.match(fidelityDiagnostics[0].text, /examAuthorityRefs/);
      return true;
    }
  );
}

assert.equal(
  existsSync(path.join(tempRepo, '.atm/history/tasks/TASK-FID-0001.json')),
  false,
  'a fail-closed import must not leave a reduced ledger record behind'
);

// ── Fail-closed when a declared contract field loses its projection ────────
// This is the ATM-GOV-0269 failure shape, reproduced through the seam rather
// than through any particular task id, path, or commit.
const { inspectTaskFrontmatterFidelity } = await import(
  '../../packages/cli/src/commands/tasks/task-frontmatter-fidelity.ts'
);

const droppedGraphReport = inspectTaskFrontmatterFidelity({
  frontmatter: {
    causalGraph: {
      softRelations: ['TASK-FID-0002'],
      changedPublicSeams: ['atm.example.v1'],
      phaseOwner: 'fidelity-owner'
    }
  },
  record: { workItemId: 'TASK-FID-0002' }
});
assert.equal(droppedGraphReport.ok, false, 'a record without causalGraph must fail the fidelity contract');
assert.equal(droppedGraphReport.findings[0].kind, 'dropped-governance-field');
assert.equal(droppedGraphReport.findings[0].field, 'causalGraph');

const partialGraphReport = inspectTaskFrontmatterFidelity({
  frontmatter: {
    causalGraph: {
      softRelations: ['TASK-FID-0003', 'TASK-FID-0004'],
      phaseOwner: 'fidelity-owner'
    }
  },
  record: {
    workItemId: 'TASK-FID-0003',
    causalGraph: { softRelations: ['TASK-FID-0003'], phaseOwner: 'fidelity-owner' }
  }
});
assert.equal(partialGraphReport.ok, false, 'a partially projected declaration is still fidelity loss');
assert.equal(partialGraphReport.findings[0].kind, 'partial-governance-list');
assert.equal(partialGraphReport.findings[0].field, 'causalGraph.softRelations');

const faithfulReport = inspectTaskFrontmatterFidelity({
  frontmatter: {
    causalGraph: { softRelations: ['TASK-FID-0005'], phaseOwner: 'fidelity-owner' },
    requiredTestCaseIds: ['test_fidelity_contract_ok']
  },
  record: {
    workItemId: 'TASK-FID-0005',
    causalGraph: { softRelations: ['TASK-FID-0005'], phaseOwner: 'fidelity-owner' },
    requiredTestCaseIds: ['test_fidelity_contract_ok']
  }
});
assert.equal(faithfulReport.ok, true, 'a faithful projection must not raise findings');
assert.deepEqual(faithfulReport.findings, []);

console.log('task-import-diagnostic-contract.test passed');
