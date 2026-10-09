import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamVendorLocalSecretsValidatorCase } from '../../scripts/validators/team-agents/team-vendor-local-secrets.ts';
import { runBrokerOverrideGateParityValidatorCase } from '../../scripts/validators/team-agents/broker-override-gate-parity.ts';
import { runDirectProviderExecuteAdmissionValidatorCase } from '../../scripts/validators/team-agents/direct-provider-execute-admission.ts';
import { runIntegrationCapabilityWiringValidatorCase } from '../../scripts/validators/team-agents/integration-capability-wiring.ts';

const ownedRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-vendor-cleanup-test-'));
const previous = process.env.ATM_TEMP_ROOT;
const previousCwd = process.cwd();
const sentinel = path.join(ownedRoot, 'foreign.txt');
writeFileSync(sentinel, 'preserve foreign bytes');
try {
  process.env.ATM_TEMP_ROOT = ownedRoot;
  assert.equal(await runTeamVendorLocalSecretsValidatorCase('unrelated-case'), false);
  assert.equal(await runTeamVendorLocalSecretsValidatorCase('team-vendor-local-secrets'), true);
  assert.deepEqual(readdirSync(ownedRoot), ['foreign.txt']);

  // Fail after workspace creation, at the first behavioral assertion.
  const originalEqual = assert.equal;
  const primaryError = new Error('injected validator assertion failure');
  try {
    assert.equal = (() => { throw primaryError; }) as typeof assert.equal;
    await assert.rejects(runTeamVendorLocalSecretsValidatorCase('team-vendor-local-secrets'), (error) => error === primaryError);
  } finally {
    assert.equal = originalEqual;
  }
  assert.deepEqual(readdirSync(ownedRoot), ['foreign.txt'], 'failed validator must clean its own workspace');
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve foreign bytes');
  for (const [name, run] of [
    ['broker-override-gate-parity', runBrokerOverrideGateParityValidatorCase],
    ['direct-provider-execute-admission', runDirectProviderExecuteAdmissionValidatorCase],
    ['integration-capability-wiring', runIntegrationCapabilityWiringValidatorCase]
  ] as const) {
    assert.equal(await run(name), true);
    assert.deepEqual(readdirSync(ownedRoot), ['foreign.txt'], `${name} must clean its own workspace`);
  }
  // Give accidental process.cwd() writes a disposable host, never the real repo.
  const hostCwd = path.join(ownedRoot, 'host-cwd');
  mkdirSync(hostCwd);
  process.chdir(hostCwd);
  await import('./team-state-only-runtime-admission.test.ts');
  assert.deepEqual(readdirSync(ownedRoot).sort(), ['foreign.txt', 'host-cwd'], 'state-only test fixtures must clean themselves');
  await import('../../packages/cli/src/commands/team/__tests__/team-execute-defaults.spec.ts');
  assert.deepEqual(readdirSync(ownedRoot).sort(), ['foreign.txt', 'host-cwd'], 'execute-defaults fixture must clean itself');
  assert.deepEqual(readdirSync(hostCwd), [], 'execute-defaults must not write into the invoking cwd');
  await import('../../packages/cli/src/commands/team/__tests__/team-execute-fail-closed.spec.ts');
  assert.deepEqual(readdirSync(ownedRoot).sort(), ['foreign.txt', 'host-cwd'], 'fail-closed fixtures must clean themselves');
  assert.deepEqual(readdirSync(hostCwd), [], 'fail-closed must not write into the invoking cwd');
} finally {
  process.chdir(previousCwd);
  if (previous === undefined) delete process.env.ATM_TEMP_ROOT;
  else process.env.ATM_TEMP_ROOT = previous;
  rmSync(ownedRoot, { recursive: true, force: true });
}
console.log('[team-vendor-secrets-cleanup] ok');
