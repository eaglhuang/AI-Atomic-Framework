import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyUnifiedPatch, applyUnifiedPatchDetailed, HUNK_LOCATOR_WINDOW,
  parseUnifiedPatch, parseUnifiedPatchHunks, UnifiedPatchApplicationError,
  type UnifiedPatchErrorReason
} from '../../packages/core/src/broker/unified-patch.ts';
import { composeTextPatchesAgainstBase } from '../../packages/core/src/broker/steward-base-composer.ts';
import type { PatchProposal } from '../../packages/core/src/broker/types.ts';

function fails(run: () => unknown, reason: UnifiedPatchErrorReason): void {
  assert.throws(run, (error: unknown) => error instanceof UnifiedPatchApplicationError
    && error.reason === reason && error.code === 'ATM_UNIFIED_PATCH_CONTEXT_MISMATCH');
}
function replace(start: number, old = 'needle', next = 'edited'): string {
  return `@@ -${start} +${start} @@\n-${old}\n+${next}\n`;
}
assert.equal(HUNK_LOCATOR_WINDOW, 50);
assert.equal(parseUnifiedPatchHunks, parseUnifiedPatch);
for (const offset of [1, -1, 17, -17]) {
  const lines = Array.from({ length: 60 }, (_, i) => `row-${i}`);
  const actual = 25;
  lines[actual] = 'needle';
  const applied = applyUnifiedPatchDetailed(`${lines.join('\n')}\n`, replace(actual + 1 - offset));
  assert.deepEqual(applied.hunkOffsets, [{ declaredOldStart: actual + 1 - offset, appliedOldStart: actual + 1, offset }]);
  lines[actual] = 'edited';
  assert.equal(applied.text, `${lines.join('\n')}\n`);
}
{
  const source = `${Array.from({ length: 110 }, (_, i) => i === 100 ? 'needle' : `pad-${i}`).join('\n')}\n`;
  const applied = applyUnifiedPatchDetailed(source, replace(1));
  assert.equal(applied.hunkOffsets[0]?.offset, 100);
  assert.equal(applied.text, source.replace('needle', 'edited'));
  fails(() => applyUnifiedPatch(source + 'needle\n', replace(1)), 'context-ambiguous');
}
fails(() => applyUnifiedPatch('needle\nx\nneedle\n', replace(2)), 'context-ambiguous');
fails(() => applyUnifiedPatch('x\n', replace(1)), 'context-not-found');
fails(() => applyUnifiedPatch('a\nb\nb\nc\n', replace(2, 'b', 'B'), { mode: 'unique' }), 'context-ambiguous');
assert.equal(applyUnifiedPatch('a\nb\nb\nc\n', replace(2, 'b', 'B')), 'a\nB\nb\nc\n');
{
  const result = applyUnifiedPatchDetailed('a\nb\nc\nd\ne\n', replace(1, 'b', 'B') + replace(5, 'd', 'D'));
  assert.equal(result.text, 'a\nB\nc\nD\ne\n');
  assert.deepEqual(result.hunkOffsets.map((h) => h.offset), [1, -1]);
  fails(() => applyUnifiedPatch('a\nb\nc\n', replace(1, 'b') + replace(3, 'a')), 'hunk-overlap');
}
const marker = '\\ No newline at end of file';
assert.equal(applyUnifiedPatch('pad\na\nb', `@@ -1 +1 @@\n-b\n${marker}\n+B\n${marker}\n`), 'pad\na\nB');
assert.equal(applyUnifiedPatch('pad\r\na\r\nb\r\n', replace(1, 'b', 'B')), 'pad\r\na\r\nB\r\n');
// Paper-draft row 2: an earlier writer inserted one line above the second edit.
const draft = applyUnifiedPatch('title\nrow 2\nend\n', '@@ -0,0 +1 @@\n+intro\n');
const row2 = applyUnifiedPatchDetailed(draft, replace(2, 'row 2', 'row 2 revised'));
assert.equal(row2.text, 'intro\ntitle\nrow 2 revised\nend\n');
assert.equal(row2.hunkOffsets[0]?.offset, 1);

function proposal(id: string, patch: string): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: '' },
    proposalId: id, taskId: id, actorId: id, baseCommit: 'base', fileBeforeHash: 'hash',
    targetFile: 'x', atomRefs: [], anchors: [], intent: id, patch, validators: [], rollback: 'discard'
  };
}
{
  const source = 'a\nb\nc\nd\ne\n';
  const exact = composeTextPatchesAgainstBase('x', source, [proposal('b', replace(2, 'b', 'B')), proposal('d', replace(4, 'd', 'D'))]);
  const offset = composeTextPatchesAgainstBase('x', source, [proposal('b', replace(1, 'b', 'B')), proposal('d', replace(5, 'd', 'D'))]);
  assert.equal(exact.ok, true);
  assert.deepEqual(offset, exact);
}
for (const patch of [
  '@@ -1 +1 @@\n-a\ninvalid\n+b\n', // A1
  '', '  \n', '--- a/x\n+++ b/x\n', '@@ -1,1 +1,1@@\n-a\n+b\n', // A2
  '--- a/x\n+++ b/x\n' + replace(1) + '--- a/y\n+++ b/y\n' + replace(1),
  'diff --git a/x b/x\n' + replace(1) + 'diff --git a/y b/y\n' + replace(1), // A3
  '@@ -1,2 +1,2 @@\n-a\n+b\n', // A5 short
  '@@ -1 +1 @@\n-a\n+b\n ctx\n', // A5 long
  '@@ -1 +1 @@\n-a\n+b\nunprefixed\n',
  '@@ -1 +1 @@\n' + marker + '\n-a\n+b\n',
  '@@ -1 +1 @@\n-a\n' + marker + '\n' + marker + '\n+b\n'
]) fails(() => parseUnifiedPatch(patch), 'malformed');
fails(() => parseUnifiedPatch('--- a/x\n+++ b/x\n' + replace(1), { targetFile: 'y' }), 'malformed');
fails(() => parseUnifiedPatch('diff --git a/x b/x\n' + replace(1), { targetFile: 'y' }), 'malformed');
parseUnifiedPatch('preamble\n--- a/x\n+++ b/x\n' + replace(1), { targetFile: './x' });
parseUnifiedPatch('--- a/x\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n', { targetFile: 'x' });
parseUnifiedPatch('--- a/x\n+++ b/dir\\x\n' + replace(1), { targetFile: './dir/x' });
assert.equal(applyUnifiedPatch('a\nb\nc\nd\n', '@@ -3,0 +4 @@\n+insert\n'), 'a\nb\nc\ninsert\nd\n');
assert.equal(applyUnifiedPatch('a\n', '@@ -0,0 +1 @@\n+top\n'), 'top\na\n');
fails(() => applyUnifiedPatch('a\n', '@@ -3,0 +4 @@\n+x\n'), 'out-of-range');
assert.equal(applyUnifiedPatch('a\n\nb\n', '@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n'), 'a\n\nB\n');

// Seeded differential test: all accepted results must match git byte for byte.
let seed = 359361;
function random(n: number): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
}
const directory = mkdtempSync(path.join(tmpdir(), 'atm-patch-locator-'));
let appliedCount = 0;
try {
  assert.equal(spawnSync('git', ['-C', directory, 'init', '-q']).status, 0);
  for (let sample = 0; sample < 150; sample += 1) {
    const lines = Array.from({ length: 5 + random(35) }, (_, i) => `sample-${sample}-line-${i}-${random(999)}`);
    const before = `${lines.join('\n')}\n`;
    const afterLines = [...lines];
    for (let edit = 0, count = 1 + random(4); edit < count; edit += 1) {
      const at = random(afterLines.length + 1);
      const remove = at < afterLines.length ? random(2) : 0;
      const added = remove > 0 && random(2) === 0 ? [] : [`edit-${sample}-${edit}`];
      afterLines.splice(at, remove, ...added);
    }
    const after = `${afterLines.join('\n')}\n`;
    for (const context of [0, 1, 3]) {
      writeFileSync(path.join(directory, 'before'), before);
      writeFileSync(path.join(directory, 'after'), after);
      const diff = spawnSync('git', ['diff', '--no-index', `-U${context}`, '--', 'before', 'after'], { cwd: directory, encoding: 'utf8' });
      assert.equal(diff.status, 1, diff.stderr);
      // --no-index uses two paths; both appliers operate on the old path.
      const patch = diff.stdout.replaceAll('b/after', 'b/before');
      const oracle = spawnSync('git', ['-C', directory, 'apply', '--unidiff-zero', '--whitespace=nowarn'], { input: patch, encoding: 'utf8' });
      assert.equal(oracle.status, 0, oracle.stderr);
      const expected = readFileSync(path.join(directory, 'before'), 'utf8');
      assert.equal(expected, after);
      let actual: string;
      try { actual = applyUnifiedPatch(before, patch); }
      catch (error) {
        assert.ok(error instanceof UnifiedPatchApplicationError);
        continue;
      }
      assert.equal(actual, expected, `sample ${sample}, -U${context}`);
      appliedCount += 1;
    }
  }
  assert.ok(appliedCount >= 450 * 0.95, `only ${appliedCount}/450 applied`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(`[unified-patch-locator] ok (${appliedCount}/450 differential cases)`);
