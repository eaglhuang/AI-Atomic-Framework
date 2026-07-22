import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildParallelReplayScenario } from '../../packages/core/src/schemas/parallel-replay-scenario.ts';

const scenario = buildParallelReplayScenario({
  scenarioId: 'atm-gov-0226-contract',
  generatedAt: '2026-07-21T00:00:00.000Z',
  runner: {
    entrypoint: 'release/atm-onefile/atm.mjs',
    digest: `sha256:${'1'.repeat(64)}`
  },
  thresholds: {
    starvationThresholdMs: 30000,
    thresholdSource: 'policy',
    minimumParallelOverlapRatio: 0.2,
    maximumSerializedAdmissionRatio: 0.8
  },
  coverage: {
    digest: `sha256:${'2'.repeat(64)}`
  },
  historicalInputs: [
    { role: 'bcr-receipt', count: 3 },
    { role: 'task-terminal-state', count: 2 }
  ],
  failureShapes: [
    {
      role: 'shared-surface-release-order',
      failureClass: 'release-order-divergence',
      expectedCounter: 'releaseOrderDivergenceCount',
      evidenceRef: 'historical:BCR'
    }
  ]
});

const schema = JSON.parse(readFileSync('schemas/atm.parallel-replay-scenario.v1.schema.json', 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
assert.equal(ajv.validateSchema(schema), true, ajv.errorsText());
assert.equal(ajv.validate(schema, scenario), true, ajv.errorsText());
assert.equal(scenario.disallowFixedTaskActorPathBranches, true);
assert.match(scenario.digest, /^sha256:[a-f0-9]{64}$/);

console.log('[parallel-replay-scenario-contract] ok');

