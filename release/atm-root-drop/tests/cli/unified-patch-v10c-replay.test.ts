// #359 AC8 / #361 A5 — v10c arm-B regression replay.
//
// Fixtures in tests/fixtures/unified-patch-v10c are copied from the sealed
// archive research/paper-v2/prereg-v3-smoke/2026-10-19-codex-v10c/logs/arm-b
// (steward-writes.jsonl currentFileText at the declared base hash, and the
// patches from session-*/stdout.jsonl). The archive itself is not modified.
//
// Header-count policy (#359 AC5, #361 A5): REJECT. rec 0, 2, 5 and 6 were
// submitted with header counts that disagree with their bodies, so as
// submitted they now fail closed as `malformed` (CLI 0.1.21 ignored counts and
// accepted rec 5). With the counts corrected to the bodies, the offset locator
// applies rec 0/2/6 at offsets +1/+2/-1, exactly the false rejections #359
// documents. rec 1 (lost `+` marker) and rec 4 (context changed by the other
// session) still reject either way.
//
// Runnable directly via:
//   node --strip-types tests/cli/unified-patch-v10c-replay.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UnifiedPatchApplicationError,
  applyUnifiedPatchDetailed
} from '../../packages/core/src/broker/unified-patch.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = path.join(root, 'tests', 'fixtures', 'unified-patch-v10c');
const manifest = JSON.parse(readFileSync(path.join(fixtures, 'cases.json'), 'utf8')) as {
  cases: { rec: number; file: string; baseText: string; patch: string; v0121Decision: string }[];
};

function load(rec: number) {
  const entry = manifest.cases.find((item) => item.rec === rec);
  assert.ok(entry, `fixture rec ${rec}`);
  return {
    file: entry.file,
    base: readFileSync(path.join(fixtures, entry.baseText), 'utf8'),
    patch: readFileSync(path.join(fixtures, entry.patch), 'utf8')
  };
}

/** Rewrite every hunk header so its counts match its body (test-only helper). */
function withBodyCounts(patch: string): string {
  const lines = patch.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[index]!);
    if (!header) continue;
    let oldCount = 0;
    let newCount = 0;
    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor]!.startsWith('@@') && !(cursor === lines.length - 1 && lines[cursor] === '')) {
      const marker = lines[cursor]![0] ?? ' ';
      if (marker !== '+') oldCount += 1;
      if (marker !== '-') newCount += 1;
      cursor += 1;
    }
    lines[index] = `@@ -${header[1]},${oldCount} +${header[2]},${newCount} @@${header[3]}`;
  }
  return lines.join('\n');
}

function rejects(run: () => unknown, reason: string, label: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof UnifiedPatchApplicationError, `${label}: ${String(error)}`);
    assert.equal(error.code, 'ATM_UNIFIED_PATCH_CONTEXT_MISMATCH', label);
    assert.equal(error.reason, reason, `${label}: ${error.message}`);
    return true;
  }, label);
}

// As submitted: every count-mismatched hunk fails closed before any placement.
for (const rec of [0, 1, 2, 4, 5, 6]) {
  const { file, base, patch } = load(rec);
  rejects(() => applyUnifiedPatchDetailed(base, patch, { targetFile: file }), 'malformed', `rec ${rec} as submitted`);
}

// Counts corrected: the three #359 false rejections now apply at their offsets.
for (const [rec, offset] of [[0, 1], [2, 2], [6, -1], [5, 0]] as const) {
  const { file, base, patch } = load(rec);
  const fixed = withBodyCounts(patch);
  assert.notEqual(fixed, patch, `rec ${rec} needed a count fix`);
  const applied = applyUnifiedPatchDetailed(base, fixed, { targetFile: file });
  assert.equal(applied.hunkOffsets.length, 1, `rec ${rec}`);
  assert.equal(applied.hunkOffsets[0]!.offset, offset, `rec ${rec} offset`);
  assert.notEqual(applied.text, base, `rec ${rec} changed the file`);
  // The applied text equals applying the same hunk at its true position (offset 0).
  const header = /^@@ -(\d+)/m.exec(fixed)!;
  const truePosition = fixed.replace(/^@@ -(\d+)(,\d+) \+(\d+)(,\d+) @@/m, (_m, _o, oc, _n, nc) => `@@ -${Number(header[1]) + offset}${oc} +${Number(header[1]) + offset}${nc} @@`);
  const exact = applyUnifiedPatchDetailed(base, truePosition, { targetFile: file });
  assert.equal(exact.hunkOffsets[0]!.offset, 0, `rec ${rec} true position`);
  assert.equal(applied.text, exact.text, `rec ${rec} same result as the exact header`);
}

// Counts corrected: the two correct rejections stay rejected.
for (const rec of [1, 4]) {
  const { file, base, patch } = load(rec);
  rejects(() => applyUnifiedPatchDetailed(base, withBodyCounts(patch), { targetFile: file }), 'context-not-found', `rec ${rec} with body counts`);
}

// A wrong target file is malformed even when the hunk itself would apply.
{
  const { base, patch } = load(0);
  rejects(() => applyUnifiedPatchDetailed(base, withBodyCounts(patch), { targetFile: 'django/db/migrations/writer.py' }), 'malformed', 'rec 0 wrong target');
}

console.log('[unified-patch-v10c-replay] ok');
