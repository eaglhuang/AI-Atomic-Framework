// ATM-GOV-0185 regression test.
//
// Validator summaries must expose a DAG, safe shared-cache decisions, fan-out
// candidates, and per-validator usage counters so later task cards can make
// data-backed demotion/archive decisions instead of adding more blind gates.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(root, 'scripts', 'run-validators.ts');
const cacheRoot = path.join(root, '.atm', 'runtime', 'validator-cache');

function runValidators(args: string[]): any {
  const stdout = execFileSync(process.execPath, ['--strip-types', runnerPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ATM_VALIDATOR_DAG_TEST: '1'
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
assert.equal(first.schemaId, 'atm.validatorRunSummary.v1');
assert.equal(first.failed, 0);
assert.equal(first.dag.schemaId, 'atm.validatorDag.v1');
assert.equal(first.dag.nodeCount, 1);
assert.equal(first.dag.nodes[0].name, 'validate-product-charter');
assert.equal(first.usageTelemetry.schemaId, 'atm.validatorUsageTelemetry.v1');
assert.equal(first.usageTelemetry.validators[0].schemaId, 'atm.validatorUsageCounter.v1');
assert.equal(first.usageTelemetry.validators[0].validatorId, 'validate-product-charter');
assert.equal(first.usageTelemetry.validators[0].invocationCount, 1);
assert.equal(first.usageTelemetry.validators[0].cacheMiss, 1);
assert.equal(first.usageTelemetry.validators[0].usedForDecision, false);
assert.equal(first.validators[0].cacheDecision, 'cache-miss');

const cacheFile = path.join(cacheRoot, `${first.validators[0].cacheKey}.json`);
const cacheRecord = JSON.parse(readFileSync(cacheFile, 'utf8'));
assert.equal(cacheRecord.schemaId, 'atm.validatorRunCache.v1');
assert.equal(cacheRecord.result.ok, true);

const second = runValidators(args);
assert.equal(second.failed, 0);
assert.equal(second.validators[0].cacheDecision, 'cache-hit');
assert.equal(second.validators[0].cached, true);
assert.equal(second.usageTelemetry.validators[0].invocationCount, 0);
assert.equal(second.usageTelemetry.validators[0].skippedCount, 1);
assert.equal(second.usageTelemetry.validators[0].cacheHit, 1);
assert.deepEqual(second.usageTelemetry.archiveCandidates, ['validate-product-charter']);

console.log('ok - tests/cli/validator-dag-shared-cache.test.ts');
