/**
 * The close window must tell its own unreconciled index apart from foreign work.
 *
 * Both conditions surface as "staged entries outside the governed bundle", and
 * the admission counted them without distinction, so a repository whose live
 * index had simply fallen behind HEAD was told to defer. Deferral parks a
 * byte-exact snapshot and restores it on release, which recreates the debt
 * rather than clearing it — and the debt compounds with every commit taken in
 * that state. Recorded as ATM-BUG-2026-08-12-001, slice A (diagnosis only).
 *
 * This slice changes no index, no lease ordering, and no defer semantics. It is
 * therefore asserted in both directions: proven residue must be diagnosed and
 * pointed at the drain, and genuine foreign staged work must keep byte-identical
 * treatment, including a mixed set where any foreign entry keeps the old code.
 *
 * caseId: test_int_close_window_residue_versus_foreign_diagnosis
 * semanticKey: close_window_names_own_reconciliation_debt_instead_of_foreign
 * contractEdge: close-window-staged-index-admission
 */
import assert from 'node:assert/strict';

import { evaluateCloseWindowStagedIndexAdmission } from '../../packages/cli/src/commands/tasks/close-window-staged-index-admission.ts';
import {
  classifyCloseWindowUnexpectedStaged,
  residueDisclosure,
  residueDrainCommand,
  residueDrainCommands
} from '../../packages/cli/src/commands/tasks/close-window-residue-classification.ts';

const DRAIN_COMMAND = residueDrainCommand('TASK-OWNER-0001');

function drainStub(drainedPaths: readonly string[]) {
  return () => ({
    schemaId: 'atm.liveIndexDrain.v1' as const,
    taskId: 'TASK-OWNER-0001',
    headSha: 'a'.repeat(40),
    dryRun: true,
    mutated: false,
    drainedPaths,
    alreadyAlignedPaths: [],
    retainedPaths: [],
    clean: true
  });
}

// Classification: only paths a dry-run drain actually proved become residue.
{
  const classification = classifyCloseWindowUnexpectedStaged({
    cwd: process.cwd(),
    unexpectedStagedFiles: ['src/mine.ts', 'src/theirs.ts'],
    receiptTaskIds: ['TASK-OWNER-0001'],
    readRetainedPaths: () => ['src/mine.ts'],
    proveDrainable: drainStub(['src/mine.ts'])
  });
  assert.deepEqual(classification.provenResidueFiles, ['src/mine.ts']);
  assert.deepEqual(classification.foreignStagedFiles, ['src/theirs.ts']);
  assert.equal(classification.residueSources[0]?.receiptTaskId, 'TASK-OWNER-0001');
}

// A receipt that claims nothing in the staged set is never proved, so the
// expensive proof stays off the close path.
{
  let proved = 0;
  const classification = classifyCloseWindowUnexpectedStaged({
    cwd: process.cwd(),
    unexpectedStagedFiles: ['src/theirs.ts'],
    receiptTaskIds: ['TASK-OWNER-0001'],
    readRetainedPaths: () => ['src/unrelated.ts'],
    proveDrainable: () => { proved += 1; return drainStub([])(); }
  });
  assert.equal(proved, 0, 'a non-intersecting receipt must not be proved');
  assert.deepEqual(classification.provenResidueFiles, []);
  assert.deepEqual(classification.foreignStagedFiles, ['src/theirs.ts']);
}

// A receipt that throws leaves the stricter foreign treatment in place: this
// classifier may only narrow a block, never widen or excuse one.
{
  const classification = classifyCloseWindowUnexpectedStaged({
    cwd: process.cwd(),
    unexpectedStagedFiles: ['src/mine.ts'],
    receiptTaskIds: ['TASK-OWNER-0001'],
    readRetainedPaths: () => ['src/mine.ts'],
    proveDrainable: () => { throw new Error('unreadable receipt'); }
  });
  assert.deepEqual(classification.provenResidueFiles, []);
  assert.deepEqual(classification.foreignStagedFiles, ['src/mine.ts']);
}

// Pure proven residue: distinct code, and the recovery is the drain.
{
  const admission = evaluateCloseWindowStagedIndexAdmission({
    taskId: 'TASK-CLOSING-0002',
    activeLockTaskId: null,
    unexpectedStagedFiles: ['src/mine.ts'],
    unexpectedStagedTaskIds: [],
    deferForeignStaged: false,
    provenResidueFiles: ['src/mine.ts'],
    residueDrainCommand: DRAIN_COMMAND
  });
  assert.equal(admission.ok, false, 'diagnosis must not unblock a close');
  assert.equal(admission.blockedCode, 'ATM_CLOSE_WINDOW_UNRECONCILED_RESIDUE');
  assert.ok(admission.blockedSummary?.includes(DRAIN_COMMAND));
  assert.ok(
    !/defer explicitly/i.test(admission.blockedSummary ?? ''),
    'residue must not be instructed to defer'
  );
  assert.ok(/drain/i.test(admission.blockedSummary ?? ''));
}

// Genuine foreign staged work: byte-identical to the previous behaviour.
{
  const admission = evaluateCloseWindowStagedIndexAdmission({
    taskId: 'TASK-CLOSING-0002',
    activeLockTaskId: null,
    unexpectedStagedFiles: ['src/theirs.ts'],
    unexpectedStagedTaskIds: ['TASK-OTHER-0003'],
    deferForeignStaged: false,
    provenResidueFiles: []
  });
  assert.equal(admission.blockedCode, 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS');
  assert.equal(
    admission.blockedSummary,
    'Close window blocked by foreign staged tasks (TASK-OTHER-0003); defer explicitly or wait for the other agent to commit.'
  );
}

// An unclassified legacy caller keeps the original wording exactly.
{
  const admission = evaluateCloseWindowStagedIndexAdmission({
    taskId: 'TASK-CLOSING-0002',
    activeLockTaskId: null,
    unexpectedStagedFiles: ['src/theirs.ts'],
    unexpectedStagedTaskIds: [],
    deferForeignStaged: false
  });
  assert.equal(admission.blockedCode, 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS');
  assert.equal(
    admission.blockedSummary,
    'Close window blocked by staged entries outside the governed bundle; defer explicitly or reconcile the index before closing.'
  );
}

// Mixed: any genuine foreign entry keeps the foreign code and the defer route,
// because deferring is still what that entry needs. The residue is disclosed.
{
  const admission = evaluateCloseWindowStagedIndexAdmission({
    taskId: 'TASK-CLOSING-0002',
    activeLockTaskId: null,
    unexpectedStagedFiles: ['src/mine.ts', 'src/theirs.ts'],
    unexpectedStagedTaskIds: ['TASK-OTHER-0003'],
    deferForeignStaged: false,
    provenResidueFiles: ['src/mine.ts'],
    residueDrainCommand: DRAIN_COMMAND
  });
  assert.equal(admission.blockedCode, 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS');
  assert.ok(admission.blockedSummary?.includes('TASK-OTHER-0003'));
  assert.ok(admission.blockedSummary?.includes('own unreconciled commits'));
}

// Deferral itself is untouched: an explicit defer still admits, residue or not.
{
  for (const provenResidueFiles of [[], ['src/mine.ts']]) {
    const admission = evaluateCloseWindowStagedIndexAdmission({
      taskId: 'TASK-CLOSING-0002',
      activeLockTaskId: null,
      unexpectedStagedFiles: ['src/mine.ts'],
      unexpectedStagedTaskIds: [],
      deferForeignStaged: true,
      provenResidueFiles
    });
    assert.equal(admission.ok, true);
    assert.equal(admission.blockedCode, null);
  }
}

// The staged-index lock verdict still wins over any staged-entry diagnosis.
{
  const admission = evaluateCloseWindowStagedIndexAdmission({
    taskId: 'TASK-CLOSING-0002',
    activeLockTaskId: 'TASK-OTHER-0003',
    unexpectedStagedFiles: ['src/mine.ts'],
    unexpectedStagedTaskIds: [],
    deferForeignStaged: false,
    provenResidueFiles: ['src/mine.ts']
  });
  assert.equal(admission.blockedCode, 'ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED');
}

// Ownership disclosure: residue proved by several receipts must name every
// owner. Reporting only the first told an operator to run a command that clears
// part of the debt; the close then blocked again with an identical message, so
// a correct instruction read as a failed one.
{
  const sources = [
    { path: 'src/second.ts', receiptTaskId: 'TASK-OWNER-0002', firstUnreconciledCommit: null },
    { path: 'src/first.ts', receiptTaskId: 'TASK-OWNER-0001', firstUnreconciledCommit: null },
    { path: 'src/also-second.ts', receiptTaskId: 'TASK-OWNER-0002', firstUnreconciledCommit: null }
  ];
  const commands = residueDrainCommands(sources);
  assert.deepEqual(commands, [residueDrainCommand('TASK-OWNER-0001'), residueDrainCommand('TASK-OWNER-0002')],
    'each distinct receipt owner is drained on its own terms, deduplicated and ordered');

  const disclosure = residueDisclosure({
    schemaId: 'atm.closeWindowResidueClassification.v1',
    provenResidueFiles: ['src/also-second.ts', 'src/first.ts', 'src/second.ts'],
    residueSources: sources,
    foreignStagedFiles: []
  });
  assert.deepEqual(disclosure.provenResidueEntries, [
    { path: 'src/also-second.ts', receiptTaskId: 'TASK-OWNER-0002' },
    { path: 'src/first.ts', receiptTaskId: 'TASK-OWNER-0001' },
    { path: 'src/second.ts', receiptTaskId: 'TASK-OWNER-0002' }
  ], 'every path carries the receipt that proved it');
  assert.deepEqual(disclosure.residueDrainCommands, commands);
  assert.equal(disclosure.residueDrainCommand, commands.join(' && '));
  assert.ok(disclosure.residueDrainCommand?.includes('TASK-OWNER-0002'),
    'the recovery string must not stop at the first owner');
}

// A single owner keeps the previous recovery string byte-for-byte.
{
  const disclosure = residueDisclosure({
    schemaId: 'atm.closeWindowResidueClassification.v1',
    provenResidueFiles: ['src/mine.ts'],
    residueSources: [{ path: 'src/mine.ts', receiptTaskId: 'TASK-OWNER-0001', firstUnreconciledCommit: null }],
    foreignStagedFiles: []
  });
  assert.equal(disclosure.residueDrainCommand, DRAIN_COMMAND);
}

// No residue discloses nothing and recommends nothing.
{
  const disclosure = residueDisclosure({
    schemaId: 'atm.closeWindowResidueClassification.v1',
    provenResidueFiles: [],
    residueSources: [],
    foreignStagedFiles: ['src/theirs.ts']
  });
  assert.deepEqual(disclosure.provenResidueEntries, []);
  assert.deepEqual(disclosure.residueDrainCommands, []);
  assert.equal(disclosure.residueDrainCommand, null);
}

// The multi-owner recovery reaches the operator through the admission summary.
{
  const multiOwnerCommand = residueDrainCommands([
    { path: 'src/first.ts', receiptTaskId: 'TASK-OWNER-0001', firstUnreconciledCommit: null },
    { path: 'src/second.ts', receiptTaskId: 'TASK-OWNER-0002', firstUnreconciledCommit: null }
  ]).join(' && ');
  const admission = evaluateCloseWindowStagedIndexAdmission({
    taskId: 'TASK-CLOSING-0002',
    activeLockTaskId: null,
    unexpectedStagedFiles: ['src/first.ts', 'src/second.ts'],
    unexpectedStagedTaskIds: [],
    deferForeignStaged: false,
    provenResidueFiles: ['src/first.ts', 'src/second.ts'],
    residueDrainCommand: multiOwnerCommand
  });
  assert.equal(admission.blockedCode, 'ATM_CLOSE_WINDOW_UNRECONCILED_RESIDUE');
  assert.ok(admission.blockedSummary?.includes('TASK-OWNER-0001'));
  assert.ok(admission.blockedSummary?.includes('TASK-OWNER-0002'));
}

console.log('[close-window-residue-diagnosis:test] ok');
