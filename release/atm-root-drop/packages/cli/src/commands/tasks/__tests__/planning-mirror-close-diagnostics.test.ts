import {
  buildPlanningMirrorClosebackExpectation,
  classifyPlanningMirrorPreEdit,
  evaluatePlanningMirrorDirtyFiles
} from '../planning-mirror-close-diagnostics.ts';

function fail(message: string): never {
  console.error(`[planning-mirror-close-diagnostics.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

const actorId = 'cursor-gpt-5.2';
const delivery = 'abc123def456';
const expectation = buildPlanningMirrorClosebackExpectation(actorId, delivery);

const correctCard = [
  '---',
  'task_id: TASK-AAO-0143',
  'status: done',
  'completed_at: "2026-06-18T06:00:00Z"',
  `completed_by_agent: ${actorId}`,
  `delivery_commit: "${delivery}"`,
  '---',
  '',
  '## Goal',
  ''
].join('\n');

const incorrectCard = correctCard.replace(delivery, 'wrong-sha');

assert(
  classifyPlanningMirrorPreEdit({
    relativePath: 'docs/tasks/TASK-AAO-0143.task.md',
    fileContent: correctCard,
    expectation
  }) === 'correct-pre-edit',
  'matching closeback frontmatter must classify as correct pre-edit'
);

assert(
  classifyPlanningMirrorPreEdit({
    relativePath: 'docs/tasks/TASK-AAO-0143.task.md',
    fileContent: incorrectCard,
    expectation
  }) === 'incorrect-pre-edit',
  'wrong delivery_commit must classify as incorrect pre-edit'
);

assert(
  classifyPlanningMirrorPreEdit({
    relativePath: 'docs/tasks/TASK-AAO-0143.task.md',
    fileContent: correctCard.replace('status: done', 'status: in-progress'),
    expectation
  }) === 'not-applicable',
  'non-done status must not count as closeback pre-edit'
);

console.log('[planning-mirror-close-diagnostics.test] ok');
