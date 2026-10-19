// #362: unified-patch keeps each line's own terminator. Untouched lines round-trip
// byte for byte, CR is part of context matching (as git apply does by default),
// and added lines keep the patch's bytes. A CR-free pure insertion follows the
// neighbouring file line instead (the one documented divergence from git).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyUnifiedPatch, joinSourceText, lineEol, splitSourceText,
  UnifiedPatchApplicationError, type UnifiedPatchErrorReason
} from '../../packages/core/src/broker/unified-patch.ts';
import { composeTextPatchesAgainstBase } from '../../packages/core/src/broker/steward-base-composer.ts';
import type { PatchProposal } from '../../packages/core/src/broker/types.ts';

function fails(run: () => unknown, reason: UnifiedPatchErrorReason): void {
  assert.throws(run, (error: unknown) => error instanceof UnifiedPatchApplicationError && error.reason === reason);
}
const marker = '\\ No newline at end of file';

// AC1: split/join is lossless and exposes each line's own terminator.
for (const text of ['', 'a', 'a\n', 'a\r\n', 'a\r', 'a\nb\r\nc', 'a\r\nb\nc\r\n', '\r\n\n\r\n', 'x\r\ny\r\nz']) {
  const source = splitSourceText(text);
  assert.equal(joinSourceText(source.lines, source.lineEnding, source.endsWithNewline), text, JSON.stringify(text));
}
{
  const source = splitSourceText('a\nb\r\nc');
  assert.deepEqual(source.lines.map((line, i, all) => lineEol(line, i === all.length - 1, source.endsWithNewline)), ['\n', '\r\n', '']);
}

// B1 repros from the issue: only the edited line changes.
assert.equal(applyUnifiedPatch('a\r\nb\nc\n', '@@ -3 +3 @@\n-c\n+C\n'), 'a\r\nb\nC\n');
assert.equal(applyUnifiedPatch('a\nb\r\nc\n', '@@ -1 +1 @@\n-a\n+A\n'), 'A\nb\r\nc\n');
// Mixed file, edit in the LF part and in the CRLF part, with context.
{
  const mixed = 'l1\nl2\nl3\r\nl4\r\nl5\nl6\r\n';
  assert.equal(applyUnifiedPatch(mixed, '@@ -1,3 +1,3 @@\n l1\n-l2\n+L2\n l3\r\n'), 'l1\nL2\nl3\r\nl4\r\nl5\nl6\r\n');
  assert.equal(applyUnifiedPatch(mixed, '@@ -3,3 +3,3 @@\n l3\r\n-l4\r\n+L4\r\n l5\n'), 'l1\nl2\nl3\r\nL4\r\nl5\nl6\r\n');
  // Both edits in one patch.
  assert.equal(applyUnifiedPatch(mixed, '@@ -2 +2 @@\n-l2\n+L2\n@@ -4 +4 @@\n-l4\r\n+L4\r\n'), 'l1\nL2\nl3\r\nL4\r\nl5\nl6\r\n');
}

// B2 / AC3: a patch line's own CR is kept.
assert.equal(applyUnifiedPatch('a\nb\n', '@@ -1 +1,2 @@\n a\n+X\r\n'), 'a\nX\r\nb\n', 'LF file plus a CRLF added line');
assert.equal(applyUnifiedPatch('a\nb\n', '@@ -2 +2 @@\n-b\n+b\r\n'), 'a\nb\r\n', 'an EOL-only change is expressible');
assert.equal(applyUnifiedPatch('a\r\nb\r\n', '@@ -2 +2 @@\n-b\r\n+b\n'), 'a\r\nb\n', 'and in the other direction');

// AC2: CRLF file plus an LF patch with context is a context mismatch (git refuses too).
fails(() => applyUnifiedPatch('a\r\nb\r\nc\r\n', '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'), 'context-not-found');
fails(() => applyUnifiedPatch('a\nb\nc\n', '@@ -2 +2 @@\n-b\r\n+B\r\n'), 'context-not-found');
// AC3: a CR-free pure insertion takes the neighbouring line's EOL.
assert.equal(applyUnifiedPatch('a\r\nb\r\n', '@@ -1,0 +2 @@\n+X\n'), 'a\r\nX\r\nb\r\n');
assert.equal(applyUnifiedPatch('a\r\nb\r\n', '@@ -0,0 +1 @@\n+X\n'), 'X\r\na\r\nb\r\n', 'at the top it follows the next line');
assert.equal(applyUnifiedPatch('a\nb\r\n', '@@ -1,0 +2 @@\n+X\n'), 'a\nX\nb\r\n', 'after an LF line it stays LF');
// A patch that carries CR anywhere is verbatim, even for a pure insertion.
assert.equal(applyUnifiedPatch('a\r\nb\r\n', '@@ -1,0 +2 @@\n+X\n@@ -2 +3 @@\n-b\r\n+B\r\n'), 'a\r\nX\nB\r\n');
// A CRLF-saved patch (headers end in CR too) still parses and applies.
assert.equal(applyUnifiedPatch('a\r\nb\r\n', '--- a/f\r\n+++ b/f\r\n@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+B\r\n'), 'a\r\nB\r\n');

// EOF-no-newline combined with CRLF.
assert.equal(applyUnifiedPatch('a\r\nb', `@@ -2 +2 @@\n-b\n${marker}\n+B\n${marker}\n`), 'a\r\nB');
assert.equal(applyUnifiedPatch('a\r\nb', `@@ -2 +2 @@\n-b\n${marker}\n+b\r\n`), 'a\r\nb\r\n', 'adding the final newline as CRLF');
assert.equal(applyUnifiedPatch('a\r\nb\r\n', `@@ -2 +2 @@\n-b\r\n+b\n${marker}\n`), 'a\r\nb', 'removing a CRLF final newline');
assert.equal(applyUnifiedPatch('a\r\nb\r', `@@ -1 +1 @@\n-a\r\n+A\r\n`), 'A\r\nb\r', 'a bare CR at EOF survives');
fails(() => applyUnifiedPatch('a\r\nb', `@@ -2 +2 @@\n-b\r\n${marker}\n+B\n${marker}\n`), 'context-not-found');

// Round trips: an edit to one line leaves every other byte untouched.
for (const [name, text] of [
  ['lf-only', 'one\ntwo\nthree\nfour\n'],
  ['crlf-only', 'one\r\ntwo\r\nthree\r\nfour\r\n'],
  ['mixed', 'one\ntwo\r\nthree\nfour\r\n'],
  ['lf-no-final-newline', 'one\ntwo\nthree\nfour'],
  ['crlf-no-final-newline', 'one\r\ntwo\r\nthree\r\nfour'],
  ['mixed-no-final-newline', 'one\r\ntwo\nthree\r\nfour']
] as const) {
  const source = splitSourceText(text);
  const target = source.lines[2]!;
  const out = applyUnifiedPatch(text, `@@ -3 +3 @@\n-${target}\n+${target.replace('three', 'THREE')}\n`);
  assert.equal(out, text.replace('three', 'THREE'), name);
  // A context-only patch returns the input bytes unchanged.
  assert.equal(applyUnifiedPatch(text, `@@ -2,2 +2,2 @@\n ${source.lines[1]}\n ${target}\n`), text, `${name} context-only`);
}

// The steward composer uses the same split/join and insertion rule.
{
  const proposal = (proposalId: string, patch: string): PatchProposal => ({ proposalId, actorId: proposalId, taskId: `T-${proposalId}`, targetFile: 'f.txt', patch } as unknown as PatchProposal);
  const mixed = 'l1\nl2\r\nl3\nl4\r\nl5\n';
  const a = '@@ -1,2 +1,2 @@\n-l1\n+L1\n l2\r\n';
  const b = '@@ -4,0 +5 @@\n+ins\n';
  const composed = composeTextPatchesAgainstBase('f.txt', mixed, [proposal('a', a), proposal('b', b)]);
  assert.ok(composed.ok, JSON.stringify(composed));
  assert.equal(composed.content, applyUnifiedPatch(applyUnifiedPatch(mixed, a), b));
  assert.equal(composed.content, 'L1\nl2\r\nl3\nl4\r\nins\r\nl5\n');
}

// Differential against git apply on random mixed-EOL files. Results must be
// byte-identical to git, or we refuse where git refuses. The only allowed
// difference is the documented one: a CR-free pure insertion whose added
// lines gain the neighbouring line's CR.
let seed = 362362;
function random(n: number): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
}
const eol = () => (random(2) === 0 ? '\n' : '\r\n');
function render(lines: readonly string[], ends: readonly string[], finalNewline: boolean): string {
  return lines.map((line, i) => (i === lines.length - 1 && !finalNewline ? line : `${line}${ends[i]}`)).join('');
}
function onlyDocumentedDivergence(actual: string, expected: string, patch: string): boolean {
  if (patch.includes('\r')) return false;
  const a = actual.split('\n');
  const e = expected.split('\n');
  return a.length === e.length && a.every((line, i) => line === e[i] || line === `${e[i]}\r`);
}
const directory = mkdtempSync(path.join(tmpdir(), 'atm-patch-eol-'));
const counts = { equal: 0, bothRefuse: 0, documented: 0, flippedEqual: 0, flippedRefuse: 0, oursRefuse: 0 };
try {
  assert.equal(spawnSync('git', ['-C', directory, 'init', '-q']).status, 0);
  assert.equal(spawnSync('git', ['-C', directory, 'config', 'core.autocrlf', 'false']).status, 0);
  const gitApply = (base: string, patch: string): string | null => {
    writeFileSync(path.join(directory, 'before'), base);
    const oracle = spawnSync('git', ['-C', directory, '-c', 'core.autocrlf=false', 'apply', '--unidiff-zero', '--whitespace=nowarn'], { input: patch, encoding: 'utf8' });
    return oracle.status === 0 ? readFileSync(path.join(directory, 'before'), 'utf8') : null;
  };
  const ours = (base: string, patch: string): string | null => {
    try { return applyUnifiedPatch(base, patch); }
    catch (error) { assert.ok(error instanceof UnifiedPatchApplicationError, String(error)); return null; }
  };
  for (let sample = 0; sample < 240; sample += 1) {
    const lines = Array.from({ length: 4 + random(20) }, (_, i) => `s${sample}-l${i}-${random(99)}`);
    const ends = lines.map(eol);
    const finalNewline = random(4) !== 0;
    const before = render(lines, ends, finalNewline);
    const afterLines = [...lines];
    const afterEnds = [...ends];
    for (let edit = 0, count = 1 + random(3); edit < count; edit += 1) {
      const at = random(afterLines.length + 1);
      const kind = random(3);
      if (kind === 0 && at < afterLines.length) { afterEnds[at] = afterEnds[at] === '\n' ? '\r\n' : '\n'; continue; }
      const remove = at < afterLines.length ? random(2) : 0;
      const added = remove > 0 && random(2) === 0 ? 0 : 1 + random(2);
      afterLines.splice(at, remove, ...Array.from({ length: added }, (_, k) => `e${sample}-${edit}-${k}`));
      afterEnds.splice(at, remove, ...Array.from({ length: added }, eol));
    }
    const after = render(afterLines, afterEnds, random(5) === 0 ? !finalNewline : finalNewline);
    if (after === before) continue;
    // The same lines with every terminator flipped: patches generated against
    // `before` mostly must refuse there, exactly when git refuses.
    const flipped = render(lines, ends.map((end) => (end === '\n' ? '\r\n' : '\n')), finalNewline);
    for (const context of [0, 1, 3]) {
      writeFileSync(path.join(directory, 'before'), before);
      writeFileSync(path.join(directory, 'after'), after);
      const diff = spawnSync('git', ['-C', directory, '-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color', `-U${context}`, '--', 'before', 'after'], { encoding: 'utf8' });
      assert.equal(diff.status, 1, diff.stderr);
      const patch = diff.stdout.replaceAll('b/after', 'b/before');
      for (const [base, flippedBase] of [[before, false], [flipped, true]] as const) {
        const expected = gitApply(base, patch);
        if (!flippedBase) assert.equal(expected, after, `git oracle, sample ${sample} -U${context}`);
        const actual = ours(base, patch);
        const label = `sample ${sample} -U${context}${flippedBase ? ' flipped' : ''}`;
        if (actual === expected) {
          if (expected === null) counts.bothRefuse += 1;
          else if (flippedBase) counts.flippedEqual += 1;
          else counts.equal += 1;
          if (flippedBase && expected === null) counts.flippedRefuse += 1;
          continue;
        }
        assert.ok(actual === null || (expected !== null && onlyDocumentedDivergence(actual, expected, patch)),
          `${label}: ours ${JSON.stringify(actual)} vs git ${JSON.stringify(expected)}\n${JSON.stringify(patch)}`);
        // On its own base every generated patch must match git exactly.
        assert.ok(flippedBase, `${label}: must match git on its own base`);
        if (actual === null) counts.oursRefuse += 1;
        else counts.documented += 1;
      }
    }
  }
  // Generated patches against their own base must apply nearly always.
  assert.ok(counts.equal >= 600, JSON.stringify(counts));
  assert.ok(counts.oursRefuse + counts.documented <= counts.flippedEqual, JSON.stringify(counts));
  assert.ok(counts.flippedRefuse > 100, JSON.stringify(counts));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(`[unified-patch-eol] ok ${JSON.stringify(counts)}`);
