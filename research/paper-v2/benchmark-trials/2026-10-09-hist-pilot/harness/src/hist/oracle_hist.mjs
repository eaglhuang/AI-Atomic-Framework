// oracle_v2-hist: full-byte expected content + frame checks for REAL files (no <region:> tags).
// Contract (independent of every arm):
//  1. Expected bytes = oracle's own reference applier on the immutable base + COMMITTED hunks (base coordinates).
//     Hunks of the two writers at the same insertion point have no defined order -> every order is a candidate.
//     Identical hunks from both writers are applied once and credit both (dedupe).
//     Truly overlapping committed hunks (both writers rewrote the same base line) cannot both be honoured: the
//     cluster is scored `overlap_both_applied` (misplaced if its post-image is present, lost otherwise) – never pass.
//  2. If final == any candidate: every committed hunk 'correct', every uncommitted 'blocked_absent'.
//  3. Else line diff (Myers) final vs nearest candidate; every diff chunk is attributed:
//     committed post-image lines missing / pre-image restored -> that hunk 'lost' (partial counts as lost);
//     post-image of an uncommitted hunk present -> 'blocked_leak'; extra copy of a committed post -> 'duplicate';
//     any other change to a base line outside committed ranges or any foreign line -> frame violation (corruption).
//  4. Frame rule: base lines outside every committed range must survive byte-for-byte, in order.
import { applyBaseHunks, overlapKind, sha256, toLines } from './patchkit.mjs';

export const ORACLE_HIST_VERSION = 'oracle_v2-hist-1';
export const PASS = new Set(['correct', 'blocked_absent', 'absent_uncommitted']);

export function myers(a, b) {
  const N = a.length, M = b.length, MAX = N + M, off = MAX + 1;
  const V = new Int32Array(2 * MAX + 3); const trace = [];
  for (let D = 0; D <= MAX; D++) {
    trace.push(V.slice());
    for (let k = -D; k <= D; k += 2) {
      let x = (k === -D || (k !== D && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) {
        const ops = []; let cx = N, cy = M;
        for (let d = D; d > 0; d--) {
          const Vp = trace[d]; const kk = cx - cy;
          const down = (kk === -d || (kk !== d && Vp[off + kk - 1] < Vp[off + kk + 1]));
          const pk = down ? kk + 1 : kk - 1; const px = Vp[off + pk], py = px - pk;
          while (cx > px && cy > py) { ops.push(['eq', cx - 1, cy - 1]); cx--; cy--; }
          if (down) ops.push(['ins', cx, cy - 1]); else ops.push(['del', cx - 1, cy]);
          cx = px; cy = py;
        }
        while (cx > 0 && cy > 0) { ops.push(['eq', cx - 1, cy - 1]); cx--; cy--; }
        return ops.reverse();
      }
    }
  }
  return [];
}

function permutations(arr) { if (arr.length <= 1) return [arr]; return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])); }

/** Build candidate expected outputs with per-line ownership. */
function buildCandidates(baseLines, committed) {
  // cluster overlaps / identical / same-point among committed hunks (union-find)
  const n = committed.length, par = [...Array(n).keys()];
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  const rel = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const k = overlapKind(committed[i], committed[j]);
    if (k) { par[find(i)] = find(j); rel.push([i, j, k]); }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const units = []; // each unit: list of alternative "synthetic hunk sequences"
  const overlapIds = new Set();
  for (const idx of groups.values()) {
    const hs = idx.map((i) => committed[i]);
    if (hs.length === 1) { units.push([[{ ...hs[0], owners: [hs[0].logical_id] }]]); continue; }
    const kinds = rel.filter(([i, j]) => idx.includes(i) && idx.includes(j)).map((r) => r[2]);
    if (kinds.every((k) => k === 'identical')) { units.push([[{ ...hs[0], owners: hs.map((h) => h.logical_id) }]]); continue; }
    if (kinds.every((k) => k === 'same-point')) { units.push(permutations(hs).slice(0, 24).map((p) => p.map((h) => ({ ...h, owners: [h.logical_id] })))); continue; }
    // genuine overlap: synthetic union hunk, post = concatenation in each order (never a pass: see contract 1)
    hs.forEach((h) => overlapIds.add(h.logical_id));
    const s = Math.min(...hs.map((h) => h.start)), e = Math.max(...hs.map((h) => h.end));
    units.push(permutations(hs).slice(0, 24).map((p) => [{ logical_id: `overlap:${p.map((h) => h.logical_id).join('+')}`, start: s, end: e,
      post: p.flatMap((h) => h.post), owners: p.map((h) => h.logical_id), synthetic: true, parts: p.map((h) => ({ id: h.logical_id, len: h.post.length })) }]));
  }
  let combos = [[]];
  for (const u of units) { const nx = []; for (const c of combos) for (const alt of u) nx.push([...c, ...alt]); combos = nx.slice(0, 256); }
  return {
    overlapIds,
    candidates: combos.map((seq) => {
      const sorted = [...seq].sort((a, b) => (a.start - b.start) || (a.end - b.end));
      // keep same-point hunks in the permutation order chosen
      const order = new Map(seq.map((h, i) => [h, i]));
      sorted.sort((a, b) => (a.start - b.start) || (a.end - b.end) || (order.get(a) - order.get(b)));
      const lines = [], owner = [], blocks = new Map(); let pos = 0;
      for (const h of sorted) {
        for (; pos < h.start; pos++) { lines.push(baseLines[pos]); owner.push({ frame: pos }); }
        const es = lines.length;
        if (h.synthetic) { let off = 0; for (const p of h.parts) { blocks.set(p.id, [es + off, es + off + p.len]); for (let k = 0; k < p.len; k++) owner.push({ hunk: [p.id] }); off += p.len; } }
        else { for (const id of h.owners) blocks.set(id, [es, es + h.post.length]); for (let k = 0; k < h.post.length; k++) owner.push({ hunk: h.owners }); }
        lines.push(...h.post); pos = h.end;
      }
      for (; pos < baseLines.length; pos++) { lines.push(baseLines[pos]); owner.push({ frame: pos }); }
      return { lines, owner, blocks };
    }),
  };
}


/**
 * Tiling check (primary judgement, alignment-free): the base is cut into frame segments and change SLOTS
 * (one per committed unit + one per uncommitted hunk that does not touch a committed range). Every slot has a
 * finite set of explainable contents: committed hunk present (post) / absent (pre = lost); uncommitted hunk
 * absent (pre) / leaked (post); same-point or overlapping groups: every subset x order. If F == S0 X1 S1 .. Xn Sn
 * with every Si verbatim and every Xi explainable, the frame is intact and each slot's choice is the verdict.
 * If no tiling exists, F contains bytes no combination of acks explains => corruption; Myers is used only to
 * describe the damage.
 */
function tile(B, committed, others) {
  const n = committed.length, par = [...Array(n).keys()];
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (overlapKind(committed[i], committed[j])) par[find(i)] = find(j);
  const groups = new Map(); for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(committed[i]); }
  const slots = [];
  for (const hs of groups.values()) {
    const s = Math.min(...hs.map((h) => h.start)), e = Math.max(...hs.map((h) => h.end));
    const ident = hs.length > 1 && hs.every((h) => overlapKind(h, hs[0]) === 'identical');
    const alts = [];
    if (ident || hs.length === 1) {
      alts.push({ lines: hs[0].post, present: hs.map((h) => h.logical_id), absent: [] });
      alts.push({ lines: B.slice(s, e), present: [], absent: hs.map((h) => h.logical_id) });
    } else {
      const k = Math.min(hs.length, 4);
      for (let mask = (1 << k) - 1; mask >= 0; mask--) {
        const pres = hs.slice(0, k).filter((_, i) => mask & (1 << i)); const abs = hs.filter((h) => !pres.includes(h));
        const allSamePoint = hs.every((h) => h.start === h.end && h.start === s);
        if (pres.length <= 1 || allSamePoint) {
          for (const perm of (pres.length ? permutations(pres).slice(0, 24) : [[]])) {
            const lines = pres.length === 1 ? [...B.slice(s, pres[0].start), ...pres[0].post, ...B.slice(pres[0].end, e)] : (allSamePoint ? perm.flatMap((h) => h.post) : B.slice(s, e));
            alts.push({ lines, present: perm.map((h) => h.logical_id), absent: abs.map((h) => h.logical_id), overlap: !allSamePoint && hs.length > 1 });
          }
        } else for (const perm of permutations(pres).slice(0, 24)) {
          alts.push({ lines: [...B.slice(s, Math.min(...pres.map((h) => h.start))), ...perm.flatMap((h) => h.post), ...B.slice(Math.max(...pres.map((h) => h.end)), e)],
            present: perm.map((h) => h.logical_id), absent: abs.map((h) => h.logical_id), overlap: true });
        }
      }
    }
    slots.push({ s, e, alts, ids: hs.map((h) => h.logical_id) });
  }
  for (const u of others) {
    if (slots.some((sl) => u.start < sl.e && sl.s < u.end) || slots.some((sl) => u.start === u.end && sl.s <= u.start && u.start <= sl.e) || slots.some((sl) => sl.s === sl.e && u.start <= sl.s && sl.s <= u.end)) continue;
    slots.push({ s: u.start, e: u.end, uncommitted: u.logical_id, alts: [{ lines: u.pre, present: [], absent: [], leak: [] }, { lines: u.post, present: [], absent: [], leak: [u.logical_id] }] });
  }
  slots.sort((a, b) => (a.s - b.s) || (a.e - b.e));
  for (let i = 1; i < slots.length; i++) if (slots[i].s < slots[i - 1].e) return null;   // defensive: unordered slots
  const segs = []; let pos = 0;
  for (const sl of slots) { segs.push(B.slice(pos, sl.s)); pos = sl.e; }
  segs.push(B.slice(pos));
  return { slots, segs };
}
function solveTiling(F, T) {
  const { slots, segs } = T; const memo = new Map();
  const match = (pos, arr) => { if (pos + arr.length > F.length) return false; for (let k = 0; k < arr.length; k++) if (F[pos + k] !== arr[k]) return false; return true; };
  const go = (i, pos) => {   // at slot i, F position pos, segment i-? already matched
    const key = i * 1e7 + pos; if (memo.has(key)) return memo.get(key);
    let res = null;
    if (i === slots.length) res = pos === F.length ? [] : null;
    else for (let a = 0; a < slots[i].alts.length && !res; a++) {
      const alt = slots[i].alts[a]; const seg = segs[i + 1];
      if (match(pos, alt.lines) && match(pos + alt.lines.length, seg)) { const rest = go(i + 1, pos + alt.lines.length + seg.length); if (rest) res = [a, ...rest]; }
    }
    memo.set(key, res); return res;
  };
  if (!match(0, segs[0])) return null;
  return go(0, segs[0].length);
}

export function scoreHistFile({ path, base, final, hunks }) {
  const B = toLines(base), F = toLines(final);
  const committed = hunks.filter((h) => h.terminal_outcome === 'commit');
  const others = hunks.filter((h) => h.terminal_outcome !== 'commit');
  const { candidates, overlapIds } = buildCandidates(B, committed);
  const finalText = F.join('');
  const exactIdx = candidates.findIndex((c) => c.lines.join('') === finalText);
  const byId = new Map(hunks.map((h) => [h.logical_id, h]));
  const st = new Map(hunks.map((h) => [h.logical_id, { missing: 0, reverted: 0, dup: 0, leak: 0, overlapPresent: false }]));
  let frameViolations = []; let chosen = candidates[Math.max(0, exactIdx)]; let judged_by = exactIdx >= 0 ? 'exact' : null;
  if (exactIdx < 0) {
    const T = tile(B, committed, others); const sol = T ? solveTiling(F, T) : null;
    if (sol) {
      judged_by = 'tiling';
      sol.forEach((a, i) => { const alt = T.slots[i].alts[a];
        for (const id of alt.absent) st.get(id).reverted = Math.max(1, byId.get(id).pre.length);
        for (const id of alt.absent) if (byId.get(id).post.length) st.get(id).missing = byId.get(id).post.length;
        for (const id of alt.leak ?? []) st.get(id).leak++;
        if (alt.overlap) for (const id of alt.present) st.get(id).overlapPresent = true; });
    }
  }
  if (exactIdx < 0 && judged_by == null) {
    judged_by = 'myers-fallback';
    let best = null;
    for (const c of candidates) { const ops = myers(c.lines, F); const d = ops.filter((o) => o[0] !== 'eq').length; if (!best || d < best.d) best = { c, ops, d }; }
    chosen = best.c;
    const { c, ops } = best;
    const frameIdxOfBase = new Map(); c.owner.forEach((o, i) => { if (o.frame != null) frameIdxOfBase.set(o.frame, i); });
    const uRange = others.map((u) => {
      const s = frameIdxOfBase.get(u.start) ?? (frameIdxOfBase.get(u.start - 1) != null ? frameIdxOfBase.get(u.start - 1) + 1 : null);
      return { u, es: s, ee: s == null ? null : s + (u.end - u.start) };
    });
    const chunks = []; let cur = null;
    for (const o of ops) {
      if (o[0] === 'eq') { cur = null; continue; }
      if (!cur) { cur = { p: o[1], del: [], ins: [] }; chunks.push(cur); }
      if (o[0] === 'del') cur.del.push(o[1]); else cur.ins.push(F[o[2]]);
    }
    for (const ch of chunks) {
      const lo = ch.p, hi = ch.p + ch.del.length;
      const adjC = [...c.blocks.entries()].filter(([, [es, ee]]) => es <= hi && ee >= lo).map(([id]) => byId.get(id)).filter(Boolean);
      const adjU = uRange.filter((r) => r.es != null && r.es <= hi && r.ee >= lo).map((r) => r.u);
      for (const ei of ch.del) {
        const ow = c.owner[ei];
        if (ow.hunk) { for (const id of ow.hunk) st.get(id).missing++; continue; }
        const u = uRange.find((r) => r.es != null && r.es <= ei && ei < r.ee);
        if (u) { st.get(u.u.logical_id).leak++; continue; }
        frameViolations.push({ kind: 'frame_line_removed_or_changed', base_line: ow.frame + 1, expected: c.lines[ei] });
      }
      for (const l of ch.ins) {
        const rev = adjC.find((h) => h.pre.includes(l) && !h.post.includes(l));
        if (rev) { st.get(rev.logical_id).reverted++; continue; }
        const lk = adjU.find((u) => u.post.includes(l));
        if (lk) { st.get(lk.logical_id).leak++; continue; }
        const dp = adjC.find((h) => h.post.includes(l));
        if (dp) { st.get(dp.logical_id).dup++; continue; }
        frameViolations.push({ kind: 'foreign_line', near_expected_line: lo + 1, actual: l });
      }
    }
    // no tiling exists => bytes outside every explainable combination: the file is corrupted even if Myers
    // happened to attribute every chunk (e.g. partial hunk application)
    if (frameViolations.length === 0) frameViolations.push({ kind: 'no_explainable_tiling', note: 'final bytes are not base + any subset/order of the acked hunks' });
  }
  const rows = hunks.map((h) => {
    const s = st.get(h.logical_id); const t = h.terminal_outcome ?? null;
    let verdict, reason;
    if (t == null) { verdict = 'unresolved'; reason = 'no_terminal_decision'; }
    else if (t === 'commit') {
      if (overlapIds.has(h.logical_id)) {
        const present = judged_by === 'tiling' ? s.overlapPresent : (s.missing === 0 && s.reverted === 0);
        verdict = present ? 'misplaced' : 'lost'; reason = 'overlap_both_applied';
      } else if (s.missing > 0 || s.reverted > 0) {
        const full = (h.post.length > 0 && s.missing >= h.post.length) || (h.post.length === 0 && s.reverted >= h.pre.length);
        verdict = 'lost'; reason = full ? 'effect_absent' : 'partial_effect';
      } else if (s.dup > 0) { verdict = 'duplicate'; reason = `extra_post_lines=${s.dup}`; }
      else { verdict = 'correct'; reason = exactIdx >= 0 ? 'full_bytes_exact' : (judged_by === 'tiling' ? 'present_other_slots_differ' : 'block_intact_file_corrupted'); }
    } else {
      verdict = s.leak > 0 ? 'blocked_leak' : (t === 'blocked' ? 'blocked_absent' : 'absent_uncommitted');
      reason = s.leak > 0 ? `uncommitted_effect_present:${s.leak}` : `absent_after_${t}`;
    }
    return { logical_id: h.logical_id, writer: h.writer ?? null, path, kind: h.kind, terminal_outcome: t,
      blocked_reason: h.blocked_reason ?? null, verdict, reason, pass: PASS.has(verdict) };
  });
  return {
    path, oracle_version: ORACLE_HIST_VERSION, base_digest: sha256(base), final_digest: sha256(final),
    expected_digests: candidates.map((c) => sha256(c.lines.join(''))), full_bytes_exact: exactIdx >= 0, judged_by,
    frame_ok: frameViolations.length === 0, frame_violations: frameViolations.slice(0, 20), n_frame_violations: frameViolations.length,
    overlap_both_applied: overlapIds.size > 0, rows,
  };
}

/** files: {path -> {base, final}}; hunks: all intents (with path, terminal_outcome). extraFiles: unexpected paths. */
export function scoreHistRun({ files, hunks, extraFiles = [] }) {
  const out = []; const foreign = [];
  for (const [path, { base, final }] of Object.entries(files)) {
    const hs = hunks.filter((h) => h.path === path);
    if (!hs.length) { if (final !== base) foreign.push({ path, base_digest: sha256(base), final_digest: sha256(final) }); continue; }
    out.push(scoreHistFile({ path, base, final, hunks: hs }));
  }
  const rows = out.flatMap((f) => f.rows);
  const by = {}; for (const r of rows) by[r.verdict] = (by[r.verdict] || 0) + 1;
  const summary = {
    oracle_version: ORACLE_HIST_VERSION, n_intents: rows.length, by_verdict: by,
    completed: by.correct || 0, lost_effects: by.lost || 0,
    blocked: rows.filter((r) => r.terminal_outcome !== 'commit' && r.verdict !== 'blocked_leak').length,
    misplaced: by.misplaced || 0, duplicate: by.duplicate || 0, blocked_leak: by.blocked_leak || 0, unresolved: by.unresolved || 0,
    files_scored: out.length, files_full_bytes_exact: out.filter((f) => f.full_bytes_exact).length,
    corrupted_files: out.filter((f) => !f.frame_ok).length + foreign.length,
    foreign_writes: foreign.length, extra_files: extraFiles.length,
  };
  // identity: completed + lost + blocked + (misplaced+duplicate+leak+unresolved) == total
  summary.identity_ok = summary.completed + summary.lost_effects + summary.blocked + summary.misplaced + summary.duplicate
    + summary.blocked_leak + summary.unresolved === summary.n_intents;
  summary.run_failed = summary.lost_effects + summary.misplaced + summary.duplicate + summary.blocked_leak + summary.unresolved
    + summary.corrupted_files + summary.extra_files > 0;
  return { summary, files: out.map(({ rows: _r, ...f }) => f), rows, foreign_writes: foreign, extra_files: extraFiles };
}
