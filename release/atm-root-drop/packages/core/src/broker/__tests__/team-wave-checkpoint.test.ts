// TASK-MAO-0030: tests for wave checkpoint partial-completion semantics.
import assert from 'node:assert/strict';
import { checkpointWave } from '../team-wave-checkpoint.ts';
import { createWorkerReport } from '../team-worker-report.ts';
import { sliceWaveEvidence, type WaveEvidenceMember } from '../team-wave-evidence.ts';

const evMembers: WaveEvidenceMember[] = [
  { taskId: 'T-A', scopePaths: ['src/a/'], deliverables: [] },
  { taskId: 'T-B', scopePaths: ['src/b/'], deliverables: [] }
];

function doneReport(taskId: string, file: string) {
  return createWorkerReport({
    taskId,
    workerActorId: `w-${taskId}`,
    executionState: 'done',
    changedFiles: [file],
    validatorRuns: [{ command: 'npm run typecheck', passed: true }]
  });
}

function testCleanWaveMakesDoneMembersCloseReady() {
  const evidence = sliceWaveEvidence({ members: evMembers, changedFiles: ['src/a/x.ts', 'src/b/y.ts'] });
  const result = checkpointWave({
    members: [
      { taskId: 'T-A', report: doneReport('T-A', 'src/a/x.ts') },
      { taskId: 'T-B', report: doneReport('T-B', 'src/b/y.ts') }
    ],
    evidence
  });
  assert.deepEqual([...result.closeReadyTaskIds].sort(), ['T-A', 'T-B']);
  assert.equal(result.evidenceClean, true);
}

function testNeedsReviewEvidenceBlocksAllMembers() {
  const evidence = sliceWaveEvidence({ members: evMembers, changedFiles: ['src/a/x.ts', 'src/UNKNOWN.ts'] });
  const result = checkpointWave({
    members: [{ taskId: 'T-A', report: doneReport('T-A', 'src/a/x.ts') }],
    evidence
  });
  assert.equal(result.closeReadyTaskIds.length, 0);
  assert.equal(result.members[0].state, 'needs-review');
}

function testMixedWaveOnlyDoneMemberIsCloseReady() {
  const evidence = sliceWaveEvidence({ members: evMembers, changedFiles: ['src/a/x.ts', 'src/b/y.ts'] });
  const blocked = createWorkerReport({
    taskId: 'T-B',
    workerActorId: 'w-B',
    executionState: 'blocked',
    changedFiles: ['src/b/y.ts'],
    validatorRuns: [{ command: 'npm run typecheck', passed: false, firstFailingDiagnostic: 'TS1' }]
  });
  const result = checkpointWave({
    members: [
      { taskId: 'T-A', report: doneReport('T-A', 'src/a/x.ts') },
      { taskId: 'T-B', report: blocked }
    ],
    evidence
  });
  assert.deepEqual(result.closeReadyTaskIds, ['T-A']);
  assert.equal(result.members.find((m) => m.taskId === 'T-B')!.state, 'blocked');
}

function testMissingReportIsNotStarted() {
  const evidence = sliceWaveEvidence({ members: evMembers, changedFiles: ['src/a/x.ts'] });
  const result = checkpointWave({
    members: [
      { taskId: 'T-A', report: doneReport('T-A', 'src/a/x.ts') },
      { taskId: 'T-B', report: null }
    ],
    evidence
  });
  assert.equal(result.members.find((m) => m.taskId === 'T-B')!.state, 'not-started');
  assert.deepEqual(result.closeReadyTaskIds, ['T-A']);
}

testCleanWaveMakesDoneMembersCloseReady();
testNeedsReviewEvidenceBlocksAllMembers();
testMixedWaveOnlyDoneMemberIsCloseReady();
testMissingReportIsNotStarted();

console.log('team wave checkpoint tests: ok');
