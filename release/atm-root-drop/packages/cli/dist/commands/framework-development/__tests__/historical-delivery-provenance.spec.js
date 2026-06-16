import assert from 'node:assert/strict';
import { countHistoricalDeliveryFiles, hasHistoricalDeliveryWaiver } from '../historical-delivery-provenance.js';
function provenance(overrides = {}) {
    return {
        schemaId: 'atm.historicalDeliveryProvenance.v1',
        deliveryCommitSha: '4497fb169b9d5d5de66bdf48e50afa7ec1d11c44',
        taskMatchedFiles: ['packages/cli/src/commands/framework-development.ts'],
        governanceFiles: ['.atm/history/tasks/TASK-EXAMPLE.json'],
        allowedRunnerOutputFiles: ['release/atm-onefile/atm.mjs'],
        outOfScopeSourceFiles: [],
        waivedOutOfScopeFiles: [],
        waiverReason: null,
        ...overrides
    };
}
assert.equal(hasHistoricalDeliveryWaiver(provenance()), false);
assert.equal(hasHistoricalDeliveryWaiver(provenance({
    waivedOutOfScopeFiles: ['packages/cli/src/commands/tasks.ts'],
    waiverReason: 'historical delivery commit was explicitly approved'
})), true);
assert.equal(countHistoricalDeliveryFiles(provenance({
    taskMatchedFiles: ['a.ts', 'b.ts'],
    governanceFiles: ['b.ts', 'c.json'],
    allowedRunnerOutputFiles: ['release/atm-onefile/atm.mjs'],
    outOfScopeSourceFiles: ['x.ts'],
    waivedOutOfScopeFiles: ['x.ts']
})), 5);
