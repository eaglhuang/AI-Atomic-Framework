// ATM-GOV-0200 regression test.
//
// Validator summaries must expose canonical lifecycle events and a compact
// evidence-driven tier/rollback summary without changing validator execution.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildValidatorLifecycleSummary } from '../../packages/core/src/evidence/validator-lifecycle.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(root, 'scripts', 'run-validators.ts');
const cacheRoot = path.join(root, '.atm', 'runtime', 'validator-cache');

function runValidators(args: string[]): any {
  const stdout = execFileSync(process.execPath, ['--strip-types', runnerPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ATM_VALIDATOR_LIFECYCLE_TEST: '1'
    }
  });
  return JSON.parse(stdout);
}

rmSync(cacheRoot, { recursive: true, force: true });

const args = [
  'standard',
  '--filter',
  'validate-product-charter',
  '--cache',
  '--validator-timeout-ms',
  '60000',
  '--json'
];

const first = runValidators(args);
assert.equal(first.failed, 0);
assert.equal(first.lifecycleTelemetry.schemaId, 'atm.validatorLifecycleSummary.v1');
assert.equal(first.validatorLifecycle.historyDigest, first.lifecycleTelemetry.historyDigest);
assert.equal(first.lifecycleTelemetry.optimizationId, 'ATM-GOV-0200');
assert.equal(first.lifecycleTelemetry.sourceTaskId, 'ATM-GOV-0200');
assert.equal(first.lifecycleTelemetry.dataDrivenDecision, 'insufficient-observation');
assert.equal(first.lifecycleTelemetry.observedWindow.eligibleCount, 1);
assert.equal(first.lifecycleTelemetry.observedWindow.invokedCount, 1);
assert.equal(first.lifecycleTelemetry.observedWindow.cacheMissCount, 1);
assert.ok(first.lifecycleTelemetry.events.some((event: any) => event.event === 'eligible'));
assert.ok(first.lifecycleTelemetry.events.some((event: any) => event.event === 'invoked'));
assert.ok(first.lifecycleTelemetry.events.some((event: any) => event.event === 'cache-miss'));
assert.ok(first.lifecycleTelemetry.tierProposal.insufficientObservation.includes('validate-product-charter'));
assert.equal(first.lifecycleTelemetry.rollbackReceipt.schemaId, 'atm.validatorTierRollbackReceipt.v1');
assert.equal(first.lifecycleTelemetry.rollbackReceipt.invalidatesTreatmentCache, true);
assert.equal(first.lifecycleTelemetry.consumedReceipt.consumedBy, 'ATM-GOV-0202');

const second = runValidators(args);
assert.equal(second.failed, 0);
assert.equal(second.validators[0].cacheDecision, 'cache-hit');
assert.equal(second.lifecycleTelemetry.observedWindow.skippedCount, 1);
assert.equal(second.lifecycleTelemetry.observedWindow.cacheHitCount, 1);
assert.ok(second.lifecycleTelemetry.events.some((event: any) => event.event === 'skipped'));
assert.ok(second.lifecycleTelemetry.events.some((event: any) => event.event === 'cache-hit'));
assert.ok(second.lifecycleTelemetry.tierProposal.archiveCandidate.includes('validate-product-charter'));

const fanOutSummary = buildValidatorLifecycleSummary({
  profile: 'standard',
  mode: 'validate',
  durationMs: 42,
  config: { validators: ['shared-a', 'shared-b'] },
  dag: {
    schemaId: 'atm.validatorDag.v1',
    nodes: [
      { name: 'shared-a', cacheSharingKey: 'same-owner' },
      { name: 'shared-b', cacheSharingKey: 'same-owner' }
    ]
  },
  usageTelemetry: {
    validators: [
      {
        validatorId: 'shared-a',
        validatorVersion: 'sha256:a',
        tier: 'default',
        invocationCount: 1,
        skippedCount: 0,
        durationMs: 40,
        blockingCount: 0,
        cacheDecision: 'cache-miss',
        fanOutConsumerCount: 1,
        usedForDecision: true
      },
      {
        validatorId: 'shared-b',
        validatorVersion: 'sha256:b',
        tier: 'default',
        invocationCount: 0,
        skippedCount: 1,
        durationMs: 0,
        blockingCount: 0,
        cacheDecision: 'receipt-reuse',
        fanOutConsumerCount: 0,
        usedForDecision: false
      }
    ]
  },
  validators: [
    { name: 'shared-a', ok: true, durationMs: 40, cacheDecision: 'cache-miss', cacheKey: 'sha256:a' },
    { name: 'shared-b', ok: true, durationMs: 0, cacheDecision: 'receipt-reuse', cacheKey: 'sha256:b', resumedFromReceipt: true }
  ]
});

assert.equal(fanOutSummary.observedWindow.fanOutEventCount, 1);
assert.equal(fanOutSummary.observedWindow.receiptReuseCount, 1);
assert.ok(fanOutSummary.events.some((event) => event.validatorId === 'shared-a' && event.event === 'fan-out'));
assert.ok(fanOutSummary.events.some((event) => event.validatorId === 'shared-b' && event.event === 'receipt-reuse'));
assert.ok(fanOutSummary.tierProposal.fast.includes('shared-a'));
assert.ok(fanOutSummary.tierProposal.archiveCandidate.includes('shared-b'));

console.log('ok - tests/cli/validator-observed-lifecycle.test.ts');
