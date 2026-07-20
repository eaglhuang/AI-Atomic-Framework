import assert from 'node:assert/strict';

import {
  buildFirstLayerCommandContract,
  classifyFirstLayerIntent,
  firstLayerRouteMatrix
} from '../../packages/core/src/guidance/first-layer-command-contracts.ts';

const contract = buildFirstLayerCommandContract();

assert.equal(contract.schemaId, 'atm.firstLayerCommandContract.v1');
assert.match(contract.routeMatrixDigest, /^sha256:[0-9a-f]{64}$/);
assert.equal(contract.routeMatrix.length, firstLayerRouteMatrix.length);

assert.equal(classifyFirstLayerIntent('record this ATM bug in the backlog')?.intent, 'backlog');
assert.equal(classifyFirstLayerIntent('audit the task cards and report governance residue')?.intent, 'audit');
assert.equal(classifyFirstLayerIntent('propose an optimization for captain routing friction')?.intent, 'optimization');
assert.equal(classifyFirstLayerIntent('birth atom for reusable parser helper')?.intent, 'create');

assert.equal(classifyFirstLayerIntent('catalog the first layer routing examples'), null);
assert.equal(classifyFirstLayerIntent('read the backlog without changing anything'), null);
assert.equal(classifyFirstLayerIntent('create a backlog item for this bug')?.intent, 'backlog');
assert.equal(classifyFirstLayerIntent('create a new atom for a greenfield capability')?.route, 'create-atom');

assert.ok(contract.ticketStates.some((state) => state.state === 'ATM_LOCK_CONFLICT'));
assert.match(contract.windowsSafeExamples.markdownRead, /node -e/);
assert.match(contract.windowsSafeExamples.forbiddenPattern, /PowerShell range indexing/);

console.log('ok - tests/cli/first-layer-command-contracts.test.ts');
