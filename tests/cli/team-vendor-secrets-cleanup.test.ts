import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeamVendorLocalSecretsValidatorCase } from '../../scripts/validators/team-agents/team-vendor-local-secrets.ts';

const ownedRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-vendor-cleanup-test-'));
const previous = process.env.ATM_TEMP_ROOT;
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
} finally {
  if (previous === undefined) delete process.env.ATM_TEMP_ROOT;
  else process.env.ATM_TEMP_ROOT = previous;
  rmSync(ownedRoot, { recursive: true, force: true });
}
console.log('[team-vendor-secrets-cleanup] ok');
