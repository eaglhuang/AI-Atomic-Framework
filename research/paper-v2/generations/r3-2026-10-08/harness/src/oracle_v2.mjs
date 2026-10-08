// r2 P0-2 — Oracle v2: full-byte expected content + frame/structure checks.
// Replaces the presence-based C3 judgement (exact_line/token count + optional region) for scoring.
//
// Contract (independent of the composer under test):
//   1. A reference applier builds EXPECTED full bytes from the immutable base + the committed operations
//      (insert | replace | delete) in commit order. The composer never produces the oracle's answer.
//   2. Structure: every region tag pair present in the base must exist exactly once, in order, in the final file.
//   3. Frame: after removing every authorized surviving payload line, the final file must equal the expected
//      skeleton BYTE-FOR-BYTE (catches corrupted neighbouring bytes and foreign lines even when all markers exist).
//      Authorized inserted lines may be permuted only inside their own region (inter-batch commit order is not
//      part of the contract); full_bytes_exact additionally reports the strict commit-order comparison.
//   4. Per-operation verdicts: correct | lost | duplicate | misplaced | region_missing | frame_violation |
//      superseded (legally removed by a later committed op; NOT lost) | payload_mismatch |
//      blocked_absent | blocked_leak | absent_uncommitted | unexpected_write | unresolved.
//   5. Untouched files: any fixture file with no committed op whose final bytes differ from base => foreign_write.
import { createHash } from 'node:crypto';

export const ORACLE_V2_VERSION = 'c4-fullbytes-frame-v2';
export const PASS_VERDICTS = new Set(['correct', 'superseded', 'blocked_absent', 'absent_uncommitted']);

export const sha256 = (t) => `sha256:${createHash('sha256').update(t, 'utf8').digest('hex')}`;
const openTag = (r, p) => `${p} <region:${r}>`;
const closeTag = (r, p) => `${p} </region:${r}>`;
const splitLines = (t) => { const a = t.split('\n'); return { lines: a, endsNl: t.endsWith('\n') }; };

/** Region tag lines found in text, in order: [{region, kind:'open'|'close', idx}] */
export function regionTags(text, prefix = '//') {
  const out = [];
  const re = new RegExp(`^\\s*${prefix.replace(/[/]/g, '\\/')} <(/?)region:([^>]+)>\\s*$`);
  text.split('\n').forEach((l, idx) => { const m = l.match(re); if (m) out.push({ region: m[2], kind: m[1] ? 'close' : 'open', idx }); });
  return out;
}

/** Reference applier (oracle-owned). Throws on impossible ops so contract errors surface. */
export function referenceApply(base, committedOps, prefix = '//') {
  let text = base;
  const removed = new Map(); // payload line -> logical_id that removed it
  for (const op of [...committedOps].sort((a, b) => (a.commit_seq ?? 0) - (b.commit_seq ?? 0))) {
    const lines = text.split('\n');
    if (op.kind === 'insert') {
      const ci = lines.findIndex((l) => l.trim() === closeTag(op.region, prefix));
      if (ci < 0) throw Object.assign(new Error(`reference: region ${op.region} missing for ${op.logical_id}`), { code: 'REF_REGION_MISSING' });
      lines.splice(ci, 0, op.line);
    } else if (op.kind === 'replace' || op.kind === 'delete') {
      const ti = lines.findIndex((l) => l === op.target_line);
      if (ti < 0) throw Object.assign(new Error(`reference: target missing for ${op.logical_id}`), { code: 'REF_TARGET_MISSING' });
      if (op.kind === 'replace') lines.splice(ti, 1, op.line); else lines.splice(ti, 1);
      removed.set(op.target_line, op.logical_id);
    } else throw new Error(`reference: unknown op kind ${op.kind}`);
    text = lines.join('\n');
  }
  return { content: text, removed };
}

function regionOfLine(text, lineIdx, prefix) {
  // innermost region whose open < lineIdx < close
  const tags = regionTags(text, prefix);
  let best = null;
  for (const o of tags.filter((t) => t.kind === 'open')) {
    const c = tags.find((t) => t.kind === 'close' && t.region === o.region && t.idx > o.idx);
    if (c && o.idx < lineIdx && lineIdx < c.idx && (!best || o.idx > best.o)) best = { region: o.region, o: o.idx };
  }
  return best?.region ?? null;
}

/**
 * Score one file.
 * @param {{path, base, final, ops, prefix?}} input  ops: [{logical_id,intent_id,kind,region,line,target_line,terminal_outcome,commit_seq,token?}]
 */
export function scoreFile({ path, base, final, ops, prefix = '//' }) {
  const committed = ops.filter((o) => o.terminal_outcome === 'commit');
  let expected, refError = null;
  try { expected = referenceApply(base, committed, prefix); } catch (e) { refError = e; expected = { content: null, removed: new Map() }; }
  const E = expected.content;

  // --- structure: base region tags must appear exactly once each, same order, in final
  const baseTags = regionTags(base, prefix).map((t) => `${t.kind}:${t.region}`);
  const finTags = regionTags(final, prefix).map((t) => `${t.kind}:${t.region}`);
  const structure_ok = baseTags.length === finTags.length && baseTags.every((t, i) => t === finTags[i]);
  const missingTags = baseTags.filter((t) => !finTags.includes(t));

  // --- frame: strip authorized surviving payload lines (each surviving committed op's line, any count) from both
  const survivingLines = new Set(committed.filter((o) => (o.kind === 'insert' || o.kind === 'replace')
    && !expected.removed.has(o.line)).map((o) => o.line));
  const strip = (t) => t.split('\n').filter((l) => !survivingLines.has(l)).join('\n');
  // also strip lines that belong to NON-committed ops from the final (they are judged per-op as leaks, not frame)
  const leakLines = new Set(ops.filter((o) => o.terminal_outcome !== 'commit' && o.line).map((o) => o.line));
  const stripF = (t) => t.split('\n').filter((l) => !survivingLines.has(l) && !leakLines.has(l)).join('\n');
  const skelE = E == null ? null : strip(E);
  const skelF = stripF(final);
  const frame_ok = skelE != null && skelE === skelF;
  let frame_first_diff = null;
  if (!frame_ok && skelE != null) {
    const a = skelE.split('\n'), b = skelF.split('\n');
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) { frame_first_diff = { skeleton_line: i + 1, expected: a[i] ?? null, actual: b[i] ?? null }; break; }
  }
  const full_bytes_exact = E != null && E === final;

  const finalLines = final.split('\n');
  const countLine = (l) => finalLines.reduce((n, x) => n + (x === l ? 1 : 0), 0);
  const rows = [];
  for (const op of ops) {
    const t = op.terminal_outcome ?? null;
    const payload = op.line ?? null;
    const cnt = payload ? countLine(payload) : 0;
    const tokenHit = op.token ? finalLines.some((l) => l.includes(op.token)) : false;
    let verdict, reason;
    if (t == null) { verdict = 'unresolved'; reason = 'no_terminal_decision'; }
    else if (t === 'commit') {
      const removedBy = payload ? expected.removed.get(payload) : null;
      if (removedBy && removedBy !== op.logical_id) {
        verdict = cnt === 0 ? 'superseded' : 'duplicate';
        reason = cnt === 0 ? `legally_removed_by:${removedBy}` : 'superseded_but_present';
      } else if (op.kind === 'delete') {
        const tc = countLine(op.target_line);
        verdict = tc === 0 ? (frame_ok && structure_ok ? 'correct' : 'frame_violation') : 'lost';
        reason = tc === 0 ? 'target_removed' : 'delete_not_applied';
      } else if (cnt === 0) {
        verdict = tokenHit ? 'payload_mismatch' : 'lost';
        reason = tokenHit ? 'token_present_but_line_bytes_differ' : 'effect_absent';
      } else if (cnt > 1) { verdict = 'duplicate'; reason = `occurrences=${cnt}`; }
      else if (!structure_ok) { verdict = 'region_missing'; reason = `region_tags_changed:${missingTags.join(',') || 'order'}`; }
      else {
        const at = finalLines.indexOf(payload);
        const reg = regionOfLine(final, at, prefix);
        if (op.region && reg !== op.region) { verdict = 'misplaced'; reason = `in_region:${reg ?? 'none'}`; }
        else if (!frame_ok) { verdict = 'frame_violation'; reason = frame_first_diff ? `skeleton_diff_at:${frame_first_diff.skeleton_line}` : 'reference_unavailable'; }
        else { verdict = 'correct'; reason = full_bytes_exact ? 'full_bytes_exact' : 'frame_ok_region_permutation'; }
      }
    } else if (t === 'blocked') {
      verdict = cnt === 0 && !tokenHit ? 'blocked_absent' : 'blocked_leak';
      reason = verdict === 'blocked_absent' ? 'fail_closed' : 'blocked_but_effect_present';
    } else {
      verdict = cnt === 0 && !tokenHit ? 'absent_uncommitted' : 'unexpected_write';
      reason = verdict === 'absent_uncommitted' ? `absent_after_${t}` : `write_after_${t}`;
    }
    rows.push({ logical_id: op.logical_id, intent_id: op.intent_id, path, region: op.region ?? null, kind: op.kind,
      terminal_outcome: t, occurrence_count: cnt, verdict, reason, pass: PASS_VERDICTS.has(verdict) });
  }
  return {
    path, oracle_version: ORACLE_V2_VERSION,
    base_digest: sha256(base), final_digest: sha256(final), expected_digest: E == null ? null : sha256(E),
    full_bytes_exact, frame_ok, structure_ok, frame_first_diff, reference_error: refError ? String(refError.message) : null,
    rows,
  };
}

/** Score a whole worktree. files: { path -> {base, final} } for every fixture file; ops grouped by path. */
export function scoreWorktree({ files, ops, prefix = '//' }) {
  const byPath = new Map();
  for (const o of ops) { if (!byPath.has(o.path)) byPath.set(o.path, []); byPath.get(o.path).push(o); }
  const fileResults = [];
  const foreign_writes = [];
  for (const [path, { base, final }] of Object.entries(files)) {
    const fops = byPath.get(path) ?? [];
    const anyCommit = fops.some((o) => o.terminal_outcome === 'commit');
    if (fops.length === 0 || !anyCommit) {
      if (final !== base) {
        // leaks of uncommitted ops are judged per-op; anything else is a foreign write
        const res = fops.length ? scoreFile({ path, base, final, ops: fops, prefix }) : null;
        if (!res || !res.frame_ok) foreign_writes.push({ path, base_digest: sha256(base), final_digest: sha256(final) });
        if (res) fileResults.push(res);
      } else if (fops.length) fileResults.push(scoreFile({ path, base, final, ops: fops, prefix }));
      continue;
    }
    fileResults.push(scoreFile({ path, base, final, ops: fops, prefix }));
  }
  const rows = fileResults.flatMap((f) => f.rows);
  const summary = { oracle_version: ORACLE_V2_VERSION, n_ops: rows.length, by_verdict: {}, pass: 0, fail: 0,
    files_scored: fileResults.length, files_full_bytes_exact: 0, files_frame_violation: 0, files_structure_violation: 0,
    foreign_writes: foreign_writes.length };
  for (const r of rows) { summary.by_verdict[r.verdict] = (summary.by_verdict[r.verdict] || 0) + 1; r.pass ? summary.pass++ : summary.fail++; }
  for (const f of fileResults) {
    if (f.full_bytes_exact) summary.files_full_bytes_exact++;
    if (!f.frame_ok) summary.files_frame_violation++;
    if (!f.structure_ok) summary.files_structure_violation++;
  }
  summary.correct = summary.by_verdict.correct || 0;
  summary.lost = summary.by_verdict.lost || 0;
  return { summary, files: fileResults, rows, foreign_writes };
}

/**
 * Runtime helper: score a finished run's worktree against the fixture base (all fixture files except manifest.json).
 * terminals: Map intent_id -> { outcome }. effects: from buildExpectedEffects (insert ops).
 */
export async function scoreRunWorktree({ worktree, fixtureDir, effects, terminals }) {
  const { readFileSync, readdirSync, statSync, existsSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const files = {};
  (function walk(d) {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const rel = relative(fixtureDir, p);
        if (rel === 'manifest.json') continue;
        const w = join(worktree, rel);
        files[rel] = { base: readFileSync(p, 'utf8'), final: existsSync(w) ? readFileSync(w, 'utf8') : '' };
      }
    }
  })(fixtureDir);
  const get = (id) => (terminals instanceof Map ? terminals.get(id) : terminals?.[id]);
  const ops = effects.map((e, i) => ({ logical_id: e.logical_id, intent_id: e.intent_id, path: e.path, region: e.region,
    kind: 'insert', line: e.exact_line, token: e.token, terminal_outcome: get(e.intent_id)?.outcome ?? null, commit_seq: i }));
  return scoreWorktree({ files, ops });
}

export async function writeOracleV2Artifacts(artifactsDir, res) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(join(artifactsDir, 'oracle_v2_summary.json'), JSON.stringify({ summary: res.summary, foreign_writes: res.foreign_writes,
    files: res.files.map(({ rows, ...f }) => f) }, null, 2) + '\n');
  writeFileSync(join(artifactsDir, 'oracle_v2_results.jsonl'), res.rows.map((r) => JSON.stringify(r)).join('\n') + (res.rows.length ? '\n' : ''));
}
