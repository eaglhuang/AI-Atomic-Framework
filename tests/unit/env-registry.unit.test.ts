/**
 * Unit tests for the ATM env-var registry helpers.
 * Pure: no filesystem, only `process.env` mutation in-test.
 */
import assert from 'node:assert/strict';
import {
  envRegistry,
  findEnvDescriptor,
  readEnvVar
} from '../../packages/cli/src/config/env-registry.ts';

// ── registry shape ────────────────────────────────────────────────────────
assert.ok(envRegistry.length >= 5, 'registry should list at least the 5 public vars');
for (const entry of envRegistry) {
  assert.ok(entry.name.startsWith('ATM_'), `${entry.name} must start with ATM_`);
  assert.ok(entry.surface === 'public' || entry.surface === 'internal-test',
    `${entry.name} surface invalid: ${entry.surface}`);
  assert.ok(entry.kind === 'path' || entry.kind === 'string' || entry.kind === 'boolean',
    `${entry.name} kind invalid: ${entry.kind}`);
  assert.ok(entry.purpose.length > 0, `${entry.name} purpose missing`);
  assert.ok(entry.fallback.length > 0, `${entry.name} fallback missing`);
  assert.ok(entry.consumer.length > 0, `${entry.name} consumer missing`);
}

// ── findEnvDescriptor ─────────────────────────────────────────────────────
assert.ok(findEnvDescriptor('ATM_TEMP_ROOT'), 'ATM_TEMP_ROOT should be registered');
assert.equal(findEnvDescriptor('ATM_NOT_REGISTERED'), undefined,
  'unknown name should return undefined');

// ── readEnvVar: unregistered name throws ──────────────────────────────────
{
  let thrown: unknown = null;
  try { readEnvVar('ATM_NEVER_DECLARED' as `ATM_${string}`); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof Error, 'unregistered name throws');
  assert.match((thrown as Error).message, /Unregistered ATM env var/);
}

// ── readEnvVar: registered name, unset ────────────────────────────────────
{
  const original = process.env.ATM_TEMP_ROOT;
  delete process.env.ATM_TEMP_ROOT;
  try {
    assert.equal(readEnvVar('ATM_TEMP_ROOT'), undefined, 'unset value returns undefined');
  } finally {
    if (original !== undefined) process.env.ATM_TEMP_ROOT = original;
  }
}

// ── readEnvVar: registered name, set ──────────────────────────────────────
{
  const original = process.env.ATM_TEMP_ROOT;
  process.env.ATM_TEMP_ROOT = '/tmp/atm-test';
  try {
    assert.equal(readEnvVar('ATM_TEMP_ROOT'), '/tmp/atm-test', 'set value returned');
  } finally {
    if (original === undefined) delete process.env.ATM_TEMP_ROOT;
    else process.env.ATM_TEMP_ROOT = original;
  }
}

// ── readEnvVar: whitespace-only treated as unset ──────────────────────────
{
  const original = process.env.ATM_TEMP_ROOT;
  process.env.ATM_TEMP_ROOT = '   ';
  try {
    assert.equal(readEnvVar('ATM_TEMP_ROOT'), undefined, 'whitespace is treated as unset');
  } finally {
    if (original === undefined) delete process.env.ATM_TEMP_ROOT;
    else process.env.ATM_TEMP_ROOT = original;
  }
}

// ── readEnvVar: trims surrounding whitespace ──────────────────────────────
{
  const original = process.env.ATM_TEMP_ROOT;
  process.env.ATM_TEMP_ROOT = '  /tmp/atm-test  ';
  try {
    assert.equal(readEnvVar('ATM_TEMP_ROOT'), '/tmp/atm-test', 'value is trimmed');
  } finally {
    if (original === undefined) delete process.env.ATM_TEMP_ROOT;
    else process.env.ATM_TEMP_ROOT = original;
  }
}

console.log('[unit:env-registry] ok (6 groups, 30+ assertions)');
