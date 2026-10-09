// HIST-PAIRS patch kit (general patches, not region markers).
// Hunk = { logical_id, path, start, end, kind, pre[], post[], ctx_before[], ctx_after[] }
//   start/end: 0-based [start,end) range of base lines replaced (insert: start===end, inserted before base[start]).
//   Lines keep their terminators ('\n'), so join('') reproduces exact bytes.
import { createHash } from 'node:crypto';

export const PATCHKIT_VERSION = 'hist-patchkit-v1';
export const toLines = (t) => (t === '' ? [] : t.split(/(?<=\n)/));
export const sha256 = (t) => `sha256:${createHash('sha256').update(t, 'utf8').digest('hex')}`;
const eqSeq = (a, i, pat) => { if (i < 0 || i + pat.length > a.length) return false; for (let k = 0; k < pat.length; k++) if (a[i + k] !== pat[k]) return false; return true; };

/** Do two hunks (base coordinates) overlap? identical => 'identical'. touching inserts at same point => 'same-point'. */
export function overlapKind(x, y) {
  if (x.start === y.start && x.end === y.end && x.post.join('') === y.post.join('')) return 'identical';
  if (x.start < y.end && y.start < x.end) return 'overlap';
  if (x.start === x.end && y.start === y.end && x.start === y.start) return 'same-point';
  if (x.start === x.end && y.start < x.start && x.start < y.end) return 'overlap';
  if (y.start === y.end && x.start < y.start && y.start < x.end) return 'overlap';
  return null;
}

/**
 * Reference applier (oracle-owned): apply a set of hunks, all in BASE coordinates, to base lines.
 * Non-overlapping only (caller clusters overlaps). Hunks at the same insertion point are applied in the
 * given `order` (array of logical ids) – callers enumerate both orders as acceptable candidates.
 */
export function applyBaseHunks(baseLines, hunks) {
  const hs = [...hunks].map((h, i) => ({ h, i })).sort((a, b) => (a.h.start - b.h.start) || (a.h.end - b.h.end) || (a.i - b.i));
  const out = []; let pos = 0;
  for (const { h } of hs) {
    if (h.start < pos) throw Object.assign(new Error(`overlapping hunks at ${h.logical_id}`), { code: 'REF_OVERLAP' });
    for (; pos < h.start; pos++) out.push(baseLines[pos]);
    out.push(...h.post); pos = h.end;
  }
  for (; pos < baseLines.length; pos++) out.push(baseLines[pos]);
  return out;
}

/**
 * Locate each hunk in CURRENT lines by exact ctx_before+pre+ctx_after (git-apply style, no fuzz), nearest to
 * the base position; file-start/-end anchoring when the base context was truncated. All hunks of one writer/file
 * are located against the same current bytes, must be disjoint and keep base order, then applied together.
 * Returns { ok, lines, placements } or { ok:false, reason, logical_id }.
 */
export function relocateHunks(curLines, hunks, baseLen = null) {
  const placements = [];
  for (const h of [...hunks].sort((a, b) => a.start - b.start)) {
    const pat = [...h.ctx_before, ...h.pre, ...h.ctx_after];
    const anchorStart = h.ctx_before.length < 3 && h.start - h.ctx_before.length === 0;
    const anchorEnd = baseLen != null && h.ctx_after.length < 3 && h.end + h.ctx_after.length === baseLen;
    const want = h.start - h.ctx_before.length;
    let best = null;
    for (let i = 0; i + pat.length <= curLines.length; i++) {
      if (anchorStart && i !== 0) break;
      if (anchorEnd && i + pat.length !== curLines.length) continue;
      if (!eqSeq(curLines, i, pat)) continue;
      if (best == null || Math.abs(i - want) < Math.abs(best - want)) best = i;
    }
    if (pat.length === 0) best = anchorEnd ? curLines.length : 0;
    if (best == null) return { ok: false, reason: 'relocate-context-not-found', logical_id: h.logical_id };
    const s = best + h.ctx_before.length;
    placements.push({ h, s, e: s + h.pre.length });
  }
  placements.sort((a, b) => a.s - b.s);
  for (let k = 1; k < placements.length; k++) {
    if (placements[k].s < placements[k - 1].e || placements[k].h.start < placements[k - 1].h.start) {
      return { ok: false, reason: 'relocate-overlap-or-reorder', logical_id: placements[k].h.logical_id };
    }
  }
  const out = []; let pos = 0;
  for (const p of placements) { for (; pos < p.s; pos++) out.push(curLines[pos]); out.push(...p.h.post); pos = p.e; }
  for (; pos < curLines.length; pos++) out.push(curLines[pos]);
  return { ok: true, lines: out, placements: placements.map((p) => ({ logical_id: p.h.logical_id, s: p.s, e: p.e })) };
}

/** Unified diff (3 lines context, git style) for oldLines -> newLines given disjoint change blocks [{s,e,post}]. */
export function unifiedPatch(path, oldLines, blocks, ctx = 3) {
  const bs = [...blocks].sort((a, b) => a.s - b.s);
  const groups = [];
  for (const b of bs) {
    const g = groups[groups.length - 1];
    if (g && b.s - g.at(-1).e <= 2 * ctx) g.push(b); else groups.push([b]);
  }
  const fmt = (pfx, l) => (l.endsWith('\n') ? `${pfx}${l}` : `${pfx}${l}\n\\ No newline at end of file\n`);
  let out = `--- a/${path}\n+++ b/${path}\n`;
  let delta = 0;
  for (const g of groups) {
    const s0 = Math.max(0, g[0].s - ctx), e0 = Math.min(oldLines.length, g.at(-1).e + ctx);
    let body = ''; let oldN = 0, newN = 0; let pos = s0;
    for (const b of g) {
      for (; pos < b.s; pos++) { body += fmt(' ', oldLines[pos]); oldN++; newN++; }
      for (let k = b.s; k < b.e; k++) { body += fmt('-', oldLines[k]); oldN++; }
      for (const l of b.post) { body += fmt('+', l); newN++; }
      pos = b.e;
    }
    for (; pos < e0; pos++) { body += fmt(' ', oldLines[pos]); oldN++; newN++; }
    const oldStart = oldN === 0 ? s0 : s0 + 1;
    const newStart = newN === 0 ? s0 + delta : s0 + 1 + delta;
    out += `@@ -${oldStart},${oldN} +${newStart},${newN} @@\n${body}`;
    delta += newN - oldN;
  }
  return out;
}
