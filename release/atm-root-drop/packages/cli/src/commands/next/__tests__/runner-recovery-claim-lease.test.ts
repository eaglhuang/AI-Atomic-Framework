import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('packages/cli/src/commands/next/claim-orchestration.ts', 'utf8');
const brokerAdmission = source.indexOf('registerPreClaimBrokerTransaction({');
const leaseConsumption = source.indexOf('assertClaimRunnerWriteAuthority({');
const lifecycleWrite = source.indexOf("const claimResult = shouldReuseActiveClaim");

assert.ok(brokerAdmission >= 0, 'runner-recovery claim must retain the broker-admission boundary');
assert.ok(leaseConsumption > brokerAdmission,
  'runner-recovery emergency lease must not be consumed before broker admission can reject the claim');
assert.ok(leaseConsumption < lifecycleWrite,
  'runner-recovery emergency lease must be consumed before the tasks claim or renew lifecycle write');

console.log('[runner-recovery-claim-lease] ok');
