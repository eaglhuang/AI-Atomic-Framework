import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeImportEvidence, writeTaskFiles } from '../task-card-writer.ts';

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
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('task-card-writer.spec passed');
