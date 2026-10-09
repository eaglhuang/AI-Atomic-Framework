#!/usr/bin/env node
// r2 analysis-only re-score of existing raw cells with oracle v2 (full bytes + frame/structure).
// READ-ONLY on runs/*: reads fixture (immutable base), expected_effects.json, oracle_results.jsonl (harness terminal
// outcomes only — never v1 verdicts as input), final worktree bytes. Writes only to the --out directory.
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { scoreWorktree, ORACLE_V2_VERSION } from '../src/oracle_v2.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const RUNS = args.runs || join(ROOT, 'runs');
const OUT = args.out || join(ROOT, 'runs', 'r2-oracle-rescore');
const FIXTURE = join(ROOT, 'fixture');
const ONLY = args.only ? new RegExp(args.only) : null;

function fixtureCommit() { // identical algorithm to src/cli.mjs fixtureCommit()
  const h = createHash('sha256');
  const walk = (d) => readdirSync(d).sort().forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else h.update(relative(FIXTURE, p)).update(readFileSync(p)); });
  walk(FIXTURE); return 'sha256:' + h.digest('hex').slice(0, 16);
}
const FIX_COMMIT = fixtureCommit();
const fixtureFiles = [];
(function walk(d) { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (relative(FIXTURE, p) !== 'manifest.json') fixtureFiles.push(relative(FIXTURE, p)); } })(FIXTURE);
const baseOf = Object.fromEntries(fixtureFiles.map((f) => [f, readFileSync(join(FIXTURE, f), 'utf8')]));

const stageOf = (c) => (c.match(/^(e[1-5])-/)?.[1]) ?? (/^c4-/.test(c) ? 'c4' : /^d[1-5]-/.test(c) ? c.slice(0, 2) : /^steward-/.test(c) ? 'steward' : /^gaps-/.test(c) ? 'gaps' : /^r2f-/.test(c) ? 'r2-e4-forensics' : /^r3v-/.test(c) ? 'r3-replay' : /^r3m-/.test(c) ? 'r3-matrix' : /^r3r-/.test(c) ? 'r3-regression' : /^r3s-/.test(c) ? 'r3-sp-noise' : /^r3-smoke/.test(c) ? 'r3-smoke' : /^r4v-/.test(c) ? 'r4-replay' : /^r4m-/.test(c) ? 'r4-matrix' : /^r4r-/.test(c) ? 'r4-regression' : /^r5v-/.test(c) ? 'r5-replay' : /^r5m-/.test(c) ? 'r5-matrix' : /^r5r-/.test(c) ? 'r5-regression' : /^r5e-/.test(c) ? 'r5-e5' : 'support');

const rows = [], changes = [], skipped = [];
for (const cell of readdirSync(RUNS).sort()) {
  if (ONLY && !ONLY.test(cell)) continue;
  const cdir = join(RUNS, cell);
  if (!statSync(cdir).isDirectory() || !existsSync(join(cdir, 'meta.json'))) continue;
  const meta = JSON.parse(readFileSync(join(cdir, 'meta.json'), 'utf8'));
  for (const mode of ['atm', 'control']) {
    const d = join(cdir, mode);
    const orPath = join(d, 'artifacts', 'oracle_results.jsonl');
    const eePath = join(d, 'scenarios', 'expected_effects.json');
    if (!existsSync(orPath) || !existsSync(eePath)) continue;
    if (meta.fixture_commit && meta.fixture_commit !== FIX_COMMIT) { skipped.push({ cell, mode, reason: `fixture_commit ${meta.fixture_commit} != ${FIX_COMMIT}` }); continue; }
    const v1rows = readFileSync(orPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const term = new Map(v1rows.map((r) => [r.intent_id, r.terminal_outcome]));
    const v1verdict = new Map(v1rows.map((r) => [r.intent_id, r.oracle_verdict]));
    const ee = JSON.parse(readFileSync(eePath, 'utf8'));
    const ops = ee.effects.map((e, i) => ({ logical_id: e.logical_id, intent_id: e.intent_id, path: e.path, region: e.region,
      kind: 'insert', line: e.exact_line, token: e.token, terminal_outcome: term.get(e.intent_id) ?? null, commit_seq: i }));
    const wt = join(d, 'worktree');
    const files = {};
    const missing = [];
    for (const f of fixtureFiles) { const p = join(wt, f); if (!existsSync(p)) missing.push(f); files[f] = { base: baseOf[f], final: existsSync(p) ? readFileSync(p, 'utf8') : '' }; }
    // extra files in worktree (excluding .git/.atm) = foreign artefacts (e.g. torn tmp files)
    const extra = [];
    (function walk(x) { for (const f of readdirSync(x)) { if (f === '.git' || f === '.atm') continue; const p = join(x, f); if (statSync(p).isDirectory()) walk(p); else { const r = relative(wt, p); if (!(r in baseOf)) extra.push(r); } } })(wt);
    const res = scoreWorktree({ files, ops });
    const v1 = {};
    for (const r of v1rows) v1[r.oracle_verdict] = (v1[r.oracle_verdict] || 0) + 1;
    const cellChanges = res.rows.filter((r) => v1verdict.get(r.intent_id) !== r.verdict && !(v1verdict.get(r.intent_id) === 'blocked_absent' && r.verdict === 'blocked_absent'));
    for (const r of cellChanges) changes.push({ cell, mode, intent_id: r.intent_id, path: r.path, v1: v1verdict.get(r.intent_id) ?? null, v2: r.verdict, reason: r.reason });
    rows.push({ cell, mode, stage: stageOf(cell), arm: meta.arm ?? meta.params?.arm ?? meta.params?.atm_writer ?? null,
      procs: meta.procs ?? null, n_ops: res.summary.n_ops,
      v1_correct: v1.correct || 0, v2_correct: res.summary.correct, delta_correct: res.summary.correct - (v1.correct || 0),
      v1_lost: v1.lost || 0, v2_lost: res.summary.lost,
      v1_fail: v1rows.filter((r) => r.outcome === 'test_fail').length, v2_fail: res.summary.fail,
      v2_by_verdict: res.summary.by_verdict, files_frame_violation: res.summary.files_frame_violation,
      files_structure_violation: res.summary.files_structure_violation, files_full_bytes_exact: res.summary.files_full_bytes_exact,
      files_scored: res.summary.files_scored, foreign_writes: res.foreign_writes.map((f) => f.path), extra_files: extra, missing_files: missing,
      n_changed: cellChanges.length });
  }
}
mkdirSync(OUT, { recursive: true });
const agg = {};
for (const r of rows) {
  const a = agg[r.stage] ??= { cells: 0, ops: 0, v1_correct: 0, v2_correct: 0, v1_lost: 0, v2_lost: 0, v1_fail: 0, v2_fail: 0, cells_changed: 0, ops_changed: 0, frame_violation_files: 0, structure_violation_files: 0, foreign_writes: 0, extra_files: 0 };
  a.cells++; a.ops += r.n_ops; a.v1_correct += r.v1_correct; a.v2_correct += r.v2_correct; a.v1_lost += r.v1_lost; a.v2_lost += r.v2_lost;
  a.v1_fail += r.v1_fail; a.v2_fail += r.v2_fail; a.cells_changed += r.n_changed > 0 ? 1 : 0; a.ops_changed += r.n_changed;
  a.frame_violation_files += r.files_frame_violation; a.structure_violation_files += r.files_structure_violation;
  a.foreign_writes += r.foreign_writes.length; a.extra_files += r.extra_files.length;
}
writeFileSync(join(OUT, 'rescore_cells.json'), JSON.stringify({ oracle_version: ORACLE_V2_VERSION, fixture_commit: FIX_COMMIT, rows, skipped }, null, 1) + '\n');
writeFileSync(join(OUT, 'rescore_changes.json'), JSON.stringify(changes, null, 1) + '\n');
writeFileSync(join(OUT, 'rescore_by_stage.json'), JSON.stringify(agg, null, 2) + '\n');
const hdr = ['stage', 'cells', 'ops', 'v1_correct', 'v2_correct', 'v1_lost', 'v2_lost', 'v1_fail', 'v2_fail', 'cells_changed', 'ops_changed', 'frame_violation_files', 'structure_violation_files', 'foreign_writes', 'extra_files'];
const md = ['# Oracle v2 analysis-only re-score（r2 P0-2）', '',
  `oracle：\`${ORACLE_V2_VERSION}\`；fixture \`${FIX_COMMIT}\`；raw 唯讀；輸入只用 harness terminal outcome＋最終 bytes＋fixture base（不使用 v1 verdict）。`, '',
  '| ' + hdr.join(' | ') + ' |', '|' + hdr.map(() => '---').join('|') + '|',
  ...Object.entries(agg).sort().map(([s, a]) => '| ' + [s, ...hdr.slice(1).map((k) => a[k])].join(' | ') + ' |'), '',
  `skipped（fixture 不同）：${skipped.length}`, '',
  '## 改判明細（v1 → v2）', '', changes.length ? '| cell | intent | path | v1 | v2 | reason |\n|---|---|---|---|---|---|\n' + changes.map((c) => `| ${c.cell} | ${c.intent_id} | ${c.path} | ${c.v1} | ${c.v2} | ${c.reason} |`).join('\n') : '（無）', ''].join('\n');
writeFileSync(join(OUT, 'RESCORE_SUMMARY.md'), md);
console.log(md.split('## 改判明細')[0]);
console.log(`changes=${changes.length}`);
