// Behavioural parity between the CLI's unified-patch module and the kit's
// generated copy (#359, #361). Run by test-hunk-locator-parity.sh with
//   node --experimental-strip-types test/hunk-locator-parity.mjs
// Every case must give the same text and hunk offsets, or the same error
// (name, code, reason, message), in both modules and both locate modes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..');
const core = await import(path.join(REPO, 'packages/core/src/broker/unified-patch.ts'));
const kit = await import(path.join(HERE, '..', 'bin', 'unified-patch.generated.mjs'));

const exportedCore = Object.keys(core).sort();
assert.deepEqual(Object.keys(kit).sort(), exportedCore, 'generated copy exports the same names');
assert.equal(kit.HUNK_LOCATOR_WINDOW, core.HUNK_LOCATOR_WINDOW);

function outcome(mod, before, patch, options) {
  try {
    const result = mod.applyUnifiedPatchDetailed(before, patch, options);
    return {
      ok: true,
      text: result.text,
      hunkOffsets: result.hunkOffsets,
      lines: mod.locatedLineIndexes(result.located)
    };
  } catch (error) {
    return { ok: false, name: error?.name, code: error?.code, reason: error?.reason, message: error?.message };
  }
}

const cases = [];
const add = (label, before, patch, options = {}) => cases.push({ label, before, patch, options });

// Hand-written corpus: offsets, fallback, ambiguity, overlap, EOF, CRLF, -U0, malformed.
const big = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
add('offset +1', 'x\na\nb\nc\n', '@@ -1,2 +1,2 @@\n a\n-b\n+B\n');
add('offset -1', 'a\nb\nc\n', '@@ -2,2 +2,2 @@\n a\n-b\n+B\n');
add('outside window', big, '@@ -1,1 +1,1 @@\n-line 150\n+LINE 150\n');
add('ambiguous tie', 'b\nx\nb\n', '@@ -2,1 +2,1 @@\n-b\n+B\n');
add('ambiguous file-wide', `b\n${big}b\n`, '@@ -100,1 +100,1 @@\n-b\n+B\n');
add('not found', 'a\nb\n', '@@ -1,1 +1,1 @@\n-z\n+Z\n');
add('two hunks', 'p\na\nb\nc\nd\ne\n', '@@ -1,1 +1,1 @@\n-a\n+A\n@@ -6,1 +6,1 @@\n-e\n+E\n');
add('overlap', 'a\nb\nc\n', '@@ -2,1 +2,1 @@\n-b\n+B\n@@ -1,1 +1,1 @@\n-a\n+A\n');
add('eof no newline', 'pad\na\nb', '@@ -1 +1 @@\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n');
add('eof marker not at eof (old side)', 'b\na\nb', '@@ -1 +1 @@\n-b\n\\ No newline at end of file\n+B\n');
add('eof marker not at eof (new side)', 'a\nb\nc\n', '@@ -1 +1 @@\n-a\n+A\n\\ No newline at end of file\n');
add('crlf', 'pad\r\na\r\nb\r\n', '@@ -1 +1 @@\n-b\n+B\n');
// #362: per-line EOL preservation, CR-sensitive context, CRLF-saved patches.
add('crlf-patch-on-crlf', 'pad\r\na\r\nb\r\n', '@@ -3 +3 @@\n-b\r\n+B\r\n');
add('mixed-edit-lf-part', 'a\r\nb\nc\n', '@@ -3 +3 @@\n-c\n+C\n');
add('mixed-edit-crlf-part', 'a\nb\r\nc\n', '@@ -2 +2 @@\n-b\r\n+B\r\n');
add('lf-file-crlf-added-line', 'a\nb\n', '@@ -1 +1,2 @@\n a\n+X\r\n');
add('crlf-file-lf-context', 'a\r\nb\r\nc\r\n', '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
add('crlf-file-lf-pure-insertion', 'a\r\nb\r\n', '@@ -1,0 +2 @@\n+X\n');
add('crlf-saved-patch', 'a\r\nb\r\n', '--- a/f\r\n+++ b/f\r\n@@ -1,2 +1,2 @@\r\n a\r\n-b\r\n+B\r\n');
add('crlf-no-final-newline', 'a\r\nb', '@@ -2 +2 @@\n-b\n\\ No newline at end of file\n+b\r\n');
add('-U0 insert', 'a\nb\nc\nd\n', '@@ -3,0 +4 @@\n+insert\n');
add('-U0 top', 'a\n', '@@ -0,0 +1 @@\n+top\n');
add('-U0 past end', 'a\n', '@@ -5,0 +6 @@\n+x\n');
add('A1 unprefixed', 'l1\nl2\nl3\nl4\nl5\nl6\n', '@@ -2,3 +2,3 @@\n l2\n-l3\n+L3\nl4 (no leading space)\n-l5\n+L5\n');
add('A2 no space header', 'l1\nl2\n', '@@ -2,1 +2,1@@\n-l2\n+L2\n');
add('A2 empty', 'l1\n', '');
add('A2 headers only', 'l1\n', '--- a/x\n+++ b/x\n');
add('A3 multi-file', 'l1\nl2\nl3\nl4\nl5\nl6\n', 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-l1\n+A1\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -5 +5 @@\n-l5\n+B5\n');
add('A3 wrong target', 'l1\n', '--- a/other\n+++ b/other\n@@ -1 +1 @@\n-l1\n+L1\n', { targetFile: 'target.txt' });
add('target ok', 'l1\n', 'diff --git a/target.txt b/target.txt\n--- a/target.txt\n+++ b/target.txt\n@@ -1 +1 @@\n-l1\n+L1\n', { targetFile: './target.txt' });
add('A5 short body', 'l1\nl2\nl3\n', '@@ -2,3 +2,3 @@\n-l2\n+L2\n');
add('A5 long body', 'l1\nl2\nl3\n', '@@ -1,1 +1,1 @@\n-l1\n+L1\n l2\n');
add('stale repeated context', 'A\na\nb\nb\nc\n', '@@ -3,1 +3,1 @@\n-b\n+B3\n', { mode: 'unique' });
add('unique mode found', 'A\na\nb\nc\n', '@@ -2,1 +2,1 @@\n-b\n+B\n', { mode: 'unique' });
add('window 0', 'x\na\nb\n', '@@ -1,1 +1,1 @@\n-a\n+A\n', { window: 0 });

// v10c fixtures (copied from the sealed archive by the core replay test).
const fixtures = path.join(REPO, 'tests', 'fixtures', 'unified-patch-v10c');
const manifest = JSON.parse(readFileSync(path.join(fixtures, 'cases.json'), 'utf8'));
for (const entry of manifest.cases) {
  const base = readFileSync(path.join(fixtures, entry.baseText), 'utf8');
  const patch = readFileSync(path.join(fixtures, entry.patch), 'utf8');
  add(`v10c rec ${entry.rec}`, base, patch, { targetFile: entry.file });
  const fixed = patch.replace(/^@@ -(\d+),\d+ \+(\d+),\d+ @@/m, (m, o, n) => {
    const body = patch.slice(patch.indexOf(m) + m.length).split('\n').slice(1).filter((l, i, all) => !(i === all.length - 1 && l === ''));
    const oldCount = body.filter((l) => !l.startsWith('+')).length;
    const newCount = body.filter((l) => !l.startsWith('-')).length;
    return `@@ -${o},${oldCount} +${n},${newCount} @@`;
  });
  add(`v10c rec ${entry.rec} body counts`, base, fixed, { targetFile: entry.file });
}

// Seeded random corpus: edits with perturbed headers and occasionally corrupted bodies.
let seed = 0x359361;
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
for (let sample = 0; sample < 400; sample += 1) {
  const count = 5 + rand(60);
  const vocab = 3 + rand(12);
  const lines = Array.from({ length: count }, () => `v${rand(vocab)}`);
  const before = lines.join('\n') + (rand(5) === 0 ? '' : '\n');
  const start = rand(count);
  const span = 1 + rand(Math.min(4, count - start));
  const context = rand(3);
  const lo = Math.max(0, start - context);
  const hi = Math.min(count, start + span + context);
  const body = [];
  for (let i = lo; i < hi; i += 1) {
    if (i >= start && i < start + span) {
      body.push(`-${lines[i]}`);
      if (rand(2) === 0) body.push(`+${lines[i]}-edited`);
    } else {
      body.push(` ${lines[i]}`);
    }
  }
  if (rand(3) === 0) body.push('+added');
  if (rand(10) === 0) body.splice(rand(body.length), 1, 'unprefixed');
  const oldCount = body.filter((l) => l[0] !== '+').length + (rand(12) === 0 ? 1 : 0);
  const newCount = body.filter((l) => l[0] !== '-').length;
  const declared = Math.max(1, lo + 1 + rand(7) - 3);
  const patch = `@@ -${declared},${oldCount} +${declared},${newCount} @@\n${body.join('\n')}\n`;
  const mode = rand(4) === 0 ? 'unique' : 'nearest';
  add(`random ${sample}`, before, patch, { mode, window: rand(3) === 0 ? rand(4) : undefined });
}

let applied = 0;
const reasons = new Set();
for (const item of cases) {
  const expected = outcome(core, item.before, item.patch, item.options);
  const actual = outcome(kit, item.before, item.patch, item.options);
  assert.deepEqual(actual, expected, `parity: ${item.label}`);
  if (expected.ok) applied += 1;
  else reasons.add(expected.reason);
  const parsedCore = (() => { try { return core.parseUnifiedPatch(item.patch, item.options); } catch (e) { return e.reason; } })();
  const parsedKit = (() => { try { return kit.parseUnifiedPatch(item.patch, item.options); } catch (e) { return e.reason; } })();
  assert.deepEqual(parsedKit, parsedCore, `parse parity: ${item.label}`);
}
for (const reason of ['malformed', 'context-not-found', 'context-ambiguous', 'hunk-overlap', 'eof-marker', 'out-of-range']) {
  assert.ok(reasons.has(reason), `corpus exercises ${reason}`);
}
assert.ok(applied > 50, `corpus applies enough cases (${applied})`);
console.log(`hunk-locator-parity: ${cases.length} cases, ${applied} applied, reasons ${[...reasons].sort().join(',')}`);
