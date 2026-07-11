import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeImportEvidence, writeTaskFiles } from '../task-card-writer.ts';
import { parsePlanMarkdown } from '../legacy-impl.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-task-card-writer-'));
try {
  const task = {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-RFT-0019',
    title: 'Writer parity',
    status: 'planned',
    milestone: null,
    dependencies: [],
    acceptance: [],
    deliverables: ['packages/cli/src/commands/tasks.ts'],
    scopePaths: ['packages/cli/src/commands/tasks.ts'],
    validators: ['npm run typecheck'],
    tags: [],
    notes: null,
    source: {
      planPath: 'docs/tasks/TASK-RFT-0019.task.md',
      sectionTitle: 'TASK-RFT-0019',
      headingLine: 1,
      hash: 'hash'
    },
    importedAt: '2026-07-10T00:00:00.000Z'
  } as const;

  const written = writeTaskFiles({
    cwd,
    tasks: [task],
    force: false,
    forceOverwriteClaims: false,
    resetOpen: false,
    reopen: false
  });
  assert.equal(written.diagnostics.length, 0);
  assert.equal(written.writtenPaths[0], '.atm/history/tasks/TASK-RFT-0019.json');

  const evidencePath = writeImportEvidence({
    cwd,
    tasks: [task],
    planPath: task.source.planPath,
    generatedAt: '2026-07-10T00:00:00.000Z',
    writtenPaths: written.writtenPaths
  });
  const evidence = JSON.parse(readFileSync(path.join(cwd, evidencePath), 'utf8'));
  assert.equal(evidence.taskIds[0], 'TASK-RFT-0019');

  const splitCard = parsePlanMarkdown({
    planRelativePath: 'docs/tasks/TASK-RFT-0020.task.md',
    importedAt: '2026-07-10T00:00:00.000Z',
    planText: [
      '---',
      'task_id: TASK-RFT-0020',
      'title: "Mechanical split task facade extraction"',
      'status: planned',
      'scopePaths:',
      '  - packages/cli/src/commands/tasks.ts',
      'deliverables:',
      '  - packages/cli/src/commands/tasks.ts',
      'atomizationImpact:',
      '  ownerAtomOrMap: atm.tasks',
      '  mapUpdates:',
      '    - packages/cli/src/commands/tasks/types.ts',
      '---',
      '# TASK-RFT-0020',
      '',
      'Split the facade into module files.'
    ].join('\n')
  });
  assert.equal(splitCard.tasks.length, 1);
  assert.ok(
    splitCard.tasks[0].importDiagnostics?.some((entry) => entry.code === 'ATM_TASK_IMPORT_MECHANICAL_SPLIT_SCOPE_CHECKLIST'),
    'mechanical split cards with one declared file should surface a one-shot scope checklist'
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('task-card-writer.spec passed');
