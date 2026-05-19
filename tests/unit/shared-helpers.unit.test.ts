/**
 * Unit tests for pure helpers in `packages/cli/src/commands/shared.ts`.
 * Covers framework-version reader, message constructor, makeResult shape,
 * and the new AJV factory in `packages/core/src/validation/ajv-factory.ts`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  CliError,
  frameworkVersion,
  makeResult,
  message,
  readFrameworkVersion
} from '../../packages/cli/src/commands/shared.ts';
import {
  createAtmAjv,
  createSchemaValidator
} from '../../packages/core/src/validation/ajv-factory.ts';

// ── message() ─────────────────────────────────────────────────────────────
{
  const m = message('info', 'ATM_TEST', 'hello');
  assert.equal(m.level, 'info');
  assert.equal(m.code, 'ATM_TEST');
  assert.equal(m.text, 'hello');
  assert.deepEqual(m.data, {}, 'default data is empty object');
}

{
  const m = message('error', 'ATM_FAIL', 'bad', { foo: 1 });
  assert.deepEqual(m.data, { foo: 1 });
}

// ── makeResult() ──────────────────────────────────────────────────────────
{
  const r = makeResult({ ok: true, command: 'test', cwd: '/x' });
  assert.equal(r.ok, true);
  assert.equal(r.command, 'test');
  assert.equal(r.mode, 'standalone', 'default mode is standalone');
  assert.equal(r.cwd, '/x');
  assert.deepEqual(r.messages, [], 'default messages is empty array');
  assert.deepEqual(r.evidence, {}, 'default evidence is empty object');
}

{
  const r = makeResult({
    ok: false,
    command: 'test',
    cwd: '/x',
    mode: 'custom',
    messages: [message('warn', 'ATM_X', 't')],
    evidence: { foo: 'bar' }
  });
  assert.equal(r.mode, 'custom');
  assert.equal(r.messages.length, 1);
  assert.deepEqual(r.evidence, { foo: 'bar' });
}

// ── CliError ──────────────────────────────────────────────────────────────
{
  const e = new CliError('ATM_X', 'test message');
  assert.equal(e.code, 'ATM_X');
  assert.equal(e.exitCode, 1, 'default exit code is 1 (runtime failure)');
  assert.deepEqual(e.details, {});
  assert.ok(e instanceof Error);
}

{
  const e = new CliError('ATM_CLI_USAGE', 'usage', { exitCode: 2, details: { flag: '--x' } });
  assert.equal(e.exitCode, 2, 'usage errors use exit code 2');
  assert.deepEqual(e.details, { flag: '--x' });
}

// ── readFrameworkVersion(): fallback to bundled when package.json missing ──
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'atm-fv-'));
  try {
    const result = readFrameworkVersion(tmp);
    assert.equal(result, frameworkVersion, 'missing package.json falls back to bundled');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── readFrameworkVersion(): reads version from package.json ───────────────
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'atm-fv-'));
  try {
    writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ version: '9.9.9-test' }));
    assert.equal(readFrameworkVersion(tmp), '9.9.9-test');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── readFrameworkVersion(): malformed package.json falls back ─────────────
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'atm-fv-'));
  try {
    writeFileSync(path.join(tmp, 'package.json'), 'not json at all');
    assert.equal(readFrameworkVersion(tmp), frameworkVersion);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── readFrameworkVersion(): missing version field falls back ──────────────
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'atm-fv-'));
  try {
    writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x' }));
    assert.equal(readFrameworkVersion(tmp), frameworkVersion);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── createAtmAjv(): produces working AJV with formats ────────────────────
{
  const ajv = createAtmAjv();
  const validate = ajv.compile({
    type: 'object',
    properties: { when: { type: 'string', format: 'date-time' } },
    required: ['when']
  });
  assert.equal(validate({ when: '2025-01-01T00:00:00Z' }), true, 'date-time format works');
  assert.equal(validate({ when: 'not-a-date' }), false, 'invalid date-time is caught');
  assert.equal(validate({}), false, 'missing required field caught');
}

// ── createSchemaValidator(): cached compile + typed predicate ─────────────
{
  interface Foo { x: number }
  const isFoo = createSchemaValidator<Foo>({
    type: 'object',
    properties: { x: { type: 'number' } },
    required: ['x']
  });
  assert.equal(isFoo({ x: 1 }), true);
  assert.equal(isFoo({ x: 'no' }), false);
  assert.equal(isFoo({}), false);
}

console.log('[unit:shared-helpers] ok (10 groups, 30+ assertions)');
