import assert from 'node:assert/strict';
import { buildBrokerCensus } from '../../packages/cli/src/commands/broker/census/index.ts';

const coverage = buildBrokerCensus({
  generatedAt: '2026-07-21T00:00:00.000Z',
  projectionOnlyItemCount: 0,
  entries: [
    {
      id: 'ticket:shared-backlog-projection',
      kind: 'canonical-ticket',
      authority: 'broker-registry',
      generation: 'gen-1',
      terminalStatus: 'done',
      recoveryCommand: 'node atm.mjs broker status --json',
      observationStatus: 'observed',
      evidenceRef: '.atm/history/evidence/TASK-TMP-0004.closure-packet.json',
      ownerCard: 'TASK-TMP-0004'
    },
    {
      id: 'historical-timing:waited-ms',
      kind: 'bcr',
      authority: 'historical-evidence',
      generation: null,
      terminalStatus: 'unknown',
      recoveryCommand: 'node atm.mjs broker status --json',
      observationStatus: 'unavailable',
      evidenceRef: 'ATM-GOV-0226.unavailable-timing-receipt',
      ownerCard: 'ATM-GOV-0226'
    }
  ],
  currentSourceDiscrimination: [
    {
      backlogId: 'ATM-BUG-2026-07-20-213',
      probeCommand: 'node atm.mjs broker decision --intent-file fixture.json --json',
      frozenResult: 'Open',
      sourceResult: 'Open',
      ownerCard: 'ATM-GOV-0227',
      evidenceRef: 'probe:decision-coherence'
    }
  ]
});

assert.equal(coverage.schemaId, 'atm.sharedWriteGateCoverage.v1');
assert.equal(coverage.projectionOnlyItemCount, 0);
assert.equal(coverage.unknownOwnerCount, 0);
assert.equal(coverage.unavailableReceipts.length, 1);
assert.match(coverage.digest, /^sha256:[a-f0-9]{64}$/);
assert.equal(coverage.currentSourceDiscrimination[0].backlogId, 'ATM-BUG-2026-07-20-213');

console.log('[atm-3-divergence-census] ok');

