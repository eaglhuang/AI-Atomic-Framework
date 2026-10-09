// Contract + planted-fault tests for oracle_v2-hist and patchkit (run: node test/hist_oracle_contract.mjs)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { applyBaseHunks, relocateHunks, toLines, unifiedPatch } from '../src/hist/patchkit.mjs';
import { myers, scoreHistFile, scoreHistRun } from '../src/hist/oracle_hist.mjs';

const base = Array.from({ length: 40 }, (_, i) => `def f${i}(x):\n    return x + ${i}\n`).join('\n');
const B = toLines(base);
const H = (id, start, end, post, w = 'A') => ({ logical_id: id, writer: w, path: 'm.py', start, end, pre: B.slice(start, end), post,
  kind: start === end ? 'insert' : (post.length ? 'replace' : 'delete'), ctx_before: B.slice(Math.max(0, start - 3), start), ctx_after: B.slice(end, end + 3) });
const li = (n) => B.findIndex((l) => l === `    return x + ${n}\n`);
const hA = H('A1', li(3), li(3) + 1, ['    return x + 3  # A\n'], 'A');
const hB = H('B1', li(30), li(30), ['    """doc B"""\n'], 'B');
const hB2 = H('B2', li(20) - 1, li(20) + 1, [], 'B'); // delete def f20 + return line
const commit = (h, t = 'commit') => ({ ...h, terminal_outcome: t });
const exp = applyBaseHunks(B, [hA, hB]).join('');
let passed = 0; const ok = (name, fn) => { fn(); passed++; console.log('ok', name); };

ok('myers random LCS sanity', () => {
  for (let t = 0; t < 200; t++) {
    const a = Array.from({ length: (t * 7) % 23 }, (_, i) => String((i * t) % 5)), b = Array.from({ length: (t * 11) % 19 }, (_, i) => String((i + t) % 4));
    const ops = myers(a, b);
    const ra = ops.filter((o) => o[0] !== 'ins').map((o) => a[o[1]]), rb = ops.filter((o) => o[0] !== 'del').map((o) => o[0] === 'eq' ? a[o[1]] : b[o[2]]);
    assert.deepEqual(ra, a); assert.deepEqual(rb, b);
  }
});
ok('correct: final == expected', () => {
  const r = scoreHistFile({ path: 'm.py', base, final: exp, hunks: [commit(hA), commit(hB)] });
  assert.equal(r.full_bytes_exact, true); assert.deepEqual(r.rows.map((x) => x.verdict), ['correct', 'correct']);
});
ok('PLANTED lost update (B acked, absent)', () => {
  const final = applyBaseHunks(B, [hA]).join('');
  const r = scoreHistFile({ path: 'm.py', base, final, hunks: [commit(hA), commit(hB)] });
  assert.deepEqual(r.rows.map((x) => x.verdict), ['correct', 'lost']); assert.equal(r.frame_ok, true);
});
ok('PLANTED lost replace (pre-image restored)', () => {
  const final = applyBaseHunks(B, [hB]).join('');
  const r = scoreHistFile({ path: 'm.py', base, final, hunks: [commit(hA), commit(hB)] });
  assert.deepEqual(r.rows.map((x) => [x.verdict, x.reason]), [['lost', 'effect_absent'], ['correct', 'present_other_slots_differ']]); assert.equal(r.frame_ok, true);
});
ok('PLANTED lost delete', () => {
  const final = applyBaseHunks(B, [hA]).join('');
  const r = scoreHistFile({ path: 'm.py', base, final, hunks: [commit(hA), commit(hB2)] });
  assert.equal(r.rows[1].verdict, 'lost');
});
ok('PLANTED corruption: neighbouring frame line changed', () => {
  const L = toLines(exp); const i = L.indexOf('def f10(x):\n'); L[i] = 'def f10(y):\n';
  const r = scoreHistFile({ path: 'm.py', base, final: L.join(''), hunks: [commit(hA), commit(hB)] });
  assert.equal(r.frame_ok, false); assert.ok(r.n_frame_violations >= 1);
  const s = scoreHistRun({ files: { 'm.py': { base, final: L.join('') } }, hunks: [commit(hA), commit(hB)] }).summary;
  assert.equal(s.corrupted_files, 1); assert.equal(s.run_failed, true); assert.equal(s.lost_effects, 0);
});
ok('PLANTED corruption: torn tail (truncated file)', () => {
  const final = exp.slice(0, Math.floor(exp.length * 0.6));
  const s = scoreHistRun({ files: { 'm.py': { base, final } }, hunks: [commit(hA), commit(hB)] }).summary;
  assert.equal(s.corrupted_files, 1); assert.equal(s.lost_effects, 1); assert.equal(s.run_failed, true);
});
ok('PLANTED foreign line injected', () => {
  const L = toLines(exp); L.splice(5, 0, '# injected\n');
  const r = scoreHistFile({ path: 'm.py', base, final: L.join(''), hunks: [commit(hA), commit(hB)] });
  assert.equal(r.frame_ok, false); assert.equal(r.frame_violations[0].kind, 'foreign_line');
});
ok('blocked intent absent => blocked_absent; leaked => blocked_leak', () => {
  const r1 = scoreHistFile({ path: 'm.py', base, final: applyBaseHunks(B, [hA]).join(''), hunks: [commit(hA), commit(hB, 'blocked')] });
  assert.deepEqual(r1.rows.map((x) => x.verdict), ['correct', 'blocked_absent']);
  const r2 = scoreHistFile({ path: 'm.py', base, final: exp, hunks: [commit(hA), commit(hB, 'blocked')] });
  assert.deepEqual(r2.rows.map((x) => x.verdict), ['correct', 'blocked_leak']);
});
ok('same-point inserts: either order accepted', () => {
  const x = H('A2', li(5), li(5), ['    # A\n'], 'A'), y = H('B3', li(5), li(5), ['    # B\n'], 'B');
  for (const order of [[x, y], [y, x]]) {
    const r = scoreHistFile({ path: 'm.py', base, final: applyBaseHunks(B, order).join(''), hunks: [commit(x), commit(y)] });
    assert.deepEqual(r.rows.map((z) => z.verdict), ['correct', 'correct']);
  }
});
ok('identical hunks from both writers: applied once, both credited', () => {
  const y = { ...hA, logical_id: 'B9', writer: 'B' };
  const r = scoreHistFile({ path: 'm.py', base, final: applyBaseHunks(B, [hA]).join(''), hunks: [commit(hA), commit(y)] });
  assert.deepEqual(r.rows.map((z) => z.verdict), ['correct', 'correct']);
});
ok('overlap both applied never passes', () => {
  const y = H('B4', li(3), li(3) + 1, ['    return x + 3  # B\n'], 'B');
  const final = applyBaseHunks(B, [hA]).join('');
  const r = scoreHistFile({ path: 'm.py', base, final, hunks: [commit(hA), commit(y)] });
  assert.ok(r.rows.every((z) => !z.pass)); assert.equal(r.overlap_both_applied, true);
});
ok('PLANTED duplicate post-image', () => {
  const L = toLines(exp); const i = L.indexOf('    """doc B"""\n'); L.splice(i, 0, '    """doc B"""\n');
  const r = scoreHistFile({ path: 'm.py', base, final: L.join(''), hunks: [commit(hA), commit(hB)] });
  assert.equal(r.rows[1].verdict, 'duplicate');
});
ok('foreign write to untouched file + extra file fail the run', () => {
  const s = scoreHistRun({ files: { 'm.py': { base, final: exp }, 'o.py': { base: 'x\n', final: 'y\n' } }, hunks: [commit(hA), commit(hB)], extraFiles: ['.m.py.123.atm-tmp'] }).summary;
  assert.equal(s.foreign_writes, 1); assert.equal(s.extra_files, 1); assert.equal(s.run_failed, true); assert.equal(s.identity_ok, true);
});
ok('relocate: applies on shifted content; fails when context changed', () => {
  const shifted = ['# new header\n', '# more\n', ...B];
  const r = relocateHunks(shifted, [hA, hB], B.length); assert.equal(r.ok, true);
  assert.equal(r.lines.join(''), '# new header\n# more\n' + exp);
  const ctxChanged = applyBaseHunks(B, [H('X', li(3) + 2, li(3) + 3, ['def f4(z):\n'])]);
  assert.equal(relocateHunks(ctxChanged, [hA], B.length).ok, false);
});
ok('unifiedPatch is accepted by git apply and yields expected bytes', () => {
  const d = mkdtempSync(join(tmpdir(), 'histk-')); writeFileSync(join(d, 'm.py'), base);
  execFileSync('git', ['init', '-q', d]);
  const rel = relocateHunks(B, [hA, hB], B.length);
  const patch = unifiedPatch('m.py', B, rel.placements.map((p) => ({ s: p.s, e: p.e, post: [hA, hB].find((h) => h.logical_id === p.logical_id).post })));
  writeFileSync(join(d, 'p.patch'), patch); execFileSync('git', ['-C', d, 'apply', 'p.patch']);
  assert.equal(readFileSync(join(d, 'm.py'), 'utf8'), exp);
});
ok('PLANTED lost delete of moved code: no false corruption (tiling, alignment-free)', () => {
  // writer A deletes a block, writer B inserts an identical copy elsewhere (code move); A's delete is lost
  const blockLines = B.slice(li(10) - 1, li(12) + 1);
  const del = H('A5', li(10) - 1, li(12) + 1, [], 'A'); const ins = H('B5', li(35), li(35), blockLines, 'B');
  const final = applyBaseHunks(B, [ins]).join('');
  const r = scoreHistFile({ path: 'm.py', base, final, hunks: [commit(del), commit(ins)] });
  assert.equal(r.frame_ok, true); assert.equal(r.judged_by, 'tiling');
  assert.deepEqual(r.rows.map((x) => x.verdict), ['lost', 'correct']);
});
ok('PLANTED partial hunk application => corruption', () => {
  const big = H('A6', li(15), li(15) + 1, ['    y = x\n', '    return y + 15\n'], 'A');
  const L = applyBaseHunks(B, [big]); const i = L.indexOf('    y = x\n'); L.splice(i + 1, 1);
  const r = scoreHistFile({ path: 'm.py', base, final: L.join(''), hunks: [commit(big)] });
  assert.equal(r.frame_ok, false); assert.equal(r.judged_by, 'myers-fallback');
});
ok('overlap: only A present => B lost (never pass)', () => {
  const y = H('B6', li(3), li(3) + 1, ['    return x + 3  # B\n'], 'B');
  const r = scoreHistFile({ path: 'm.py', base, final: applyBaseHunks(B, [hA]).join(''), hunks: [commit(hA), commit(y)] });
  assert.equal(r.frame_ok, true); assert.deepEqual(r.rows.map((z) => z.verdict), ['misplaced', 'lost']);
});
console.log(`hist oracle contract: ${passed} passed`);
