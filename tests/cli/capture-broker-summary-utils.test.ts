import assert from 'node:assert/strict';
import {
  collectTags,
  collectTagsFromExperiment,
  parseScenarioTag
} from '../../scripts/capture-broker-evidence/summary-utils.ts';

const cases: readonly [string, string | null][] = [
  ['bench:scenario:TASK-EXAMPLE-0001', 'scenario'],
  ['bench: scenario :TASK-EXAMPLE-0001', 'scenario'],
  ['bench::TASK-EXAMPLE-0001', null],
  ['bench:   :TASK-EXAMPLE-0001', null],
  ['bench:', null],
  ['bench', null],
  ['request:scenario:TASK-EXAMPLE-0001', null]
];

for (const [requestId, scenario] of cases) {
  const expectedScenarios = scenario === null ? [] : [scenario];
  assert.equal(parseScenarioTag(requestId), scenario, requestId);
  assert.deepEqual(collectTags(requestId).scenarios, expectedScenarios, requestId);
  assert.deepEqual(collectTagsFromExperiment(requestId).scenarios, expectedScenarios, requestId);
}

assert.deepEqual(collectTags('bench::TASK-EXAMPLE-0001:TASK-EXAMPLE-0001:TASK-EXAMPLE-0002').tasks,
  ['TASK-EXAMPLE-0001', 'TASK-EXAMPLE-0002']);
assert.deepEqual(collectTagsFromExperiment('bench::TASK-EXAMPLE-0001').tasks, ['TASK-EXAMPLE-0001']);

console.log('[capture-broker-summary-utils] scenario normalization and task preservation passed');
