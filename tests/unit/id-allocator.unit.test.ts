/**
 * Unit tests for pure helpers in `packages/core/src/manager/id-allocator.ts`.
 *
 * Scope: only pure functions — `parseAtomId` and `normalizeAtomBucket`. The
 * filesystem-touching `allocateAtomId` belongs in the validator layer
 * because it asserts on registry shape; see `docs/testing-strategy.md`.
 */
import assert from 'node:assert/strict';
import {
  normalizeAtomBucket,
  parseAtomId,
  AtomIdAllocationError
} from '../../packages/core/src/manager/id-allocator.ts';

// ── parseAtomId: positive ──────────────────────────────────────────────────
{
  const parsed = parseAtomId('ATM-CORE-0042');
  assert.ok(parsed, 'well-formed id should parse');
  assert.equal(parsed!.atomId, 'ATM-CORE-0042');
  assert.equal(parsed!.bucket, 'CORE');
  assert.equal(parsed!.sequence, 42);
}

// ── parseAtomId: numeric bucket suffix ─────────────────────────────────────
{
  const parsed = parseAtomId('ATM-K9-0001');
  assert.ok(parsed, 'bucket with numeric suffix should parse');
  assert.equal(parsed!.bucket, 'K9');
  assert.equal(parsed!.sequence, 1);
}

// ── parseAtomId: negative cases ────────────────────────────────────────────
assert.equal(parseAtomId(''), null, 'empty string is not an id');
assert.equal(parseAtomId('atom-core-0001'), null, 'lowercase is not an id');
assert.equal(parseAtomId('ATM-core-0001'), null, 'mixed-case bucket is not an id');
assert.equal(parseAtomId('ATM-CORE-1'), null, 'short sequence is not an id');
assert.equal(parseAtomId('ATM-CORE-12345'), null, 'long sequence is not an id');
assert.equal(parseAtomId('ATM--0001'), null, 'missing bucket is not an id');
assert.equal(parseAtomId(undefined), null, 'undefined is not an id');
assert.equal(parseAtomId(null), null, 'null is not an id');

// ── parseAtomId: trims whitespace ─────────────────────────────────────────
{
  const parsed = parseAtomId('  ATM-CORE-0007  ');
  assert.ok(parsed);
  assert.equal(parsed!.atomId, 'ATM-CORE-0007');
}

// ── normalizeAtomBucket: positive ──────────────────────────────────────────
assert.equal(normalizeAtomBucket('core'), 'CORE');
assert.equal(normalizeAtomBucket('  core  '), 'CORE');
assert.equal(normalizeAtomBucket('CORE'), 'CORE');
assert.equal(normalizeAtomBucket('K9'), 'K9');

// ── normalizeAtomBucket: invalid type ──────────────────────────────────────
{
  let thrown: unknown = null;
  try { normalizeAtomBucket(42); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof AtomIdAllocationError, 'non-string bucket throws');
  assert.equal((thrown as AtomIdAllocationError).code, 'ATM_BUCKET_REQUIRED');
}

// ── normalizeAtomBucket: invalid pattern ───────────────────────────────────
for (const bad of ['', '9CORE', 'core-name', 'core_name', '-CORE']) {
  let thrown: unknown = null;
  try { normalizeAtomBucket(bad); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof AtomIdAllocationError, `bucket "${bad}" should throw`);
  const code = (thrown as AtomIdAllocationError).code;
  assert.ok(
    code === 'ATM_BUCKET_INVALID' || code === 'ATM_BUCKET_REQUIRED',
    `bucket "${bad}" should throw bucket-shape error, got ${code}`
  );
}

console.log('[unit:id-allocator] ok (5 groups, 23 assertions)');
