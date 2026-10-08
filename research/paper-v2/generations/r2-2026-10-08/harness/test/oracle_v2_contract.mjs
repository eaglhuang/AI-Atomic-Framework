#!/usr/bin/env node
// r2 P0-2 contract cases for oracle v2 (review §三 P0之二, six categories + controls).
// Every case carries an INDEPENDENT hand-written expected full-bytes string (never produced by the composer
// or by the oracle's reference applier), its sha256, an unchanged-line mask, expected verdicts, and actual verdicts.
// Also cross-checks the oracle's own reference applier against the hand-written bytes, and reports what the
// r1 presence-based oracle (c3-effect-bytes-v1) would have said for insert ops.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreFile, referenceApply, sha256, ORACLE_V2_VERSION } from '../src/oracle_v2.mjs';
import { classifyEffect, ORACLE_VERSION as V1 } from '../src/oracle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, '..', 'runs', 'r2-oracle-contract');

const BASE = [
  '// fixture header',            // 1
  '// <region:r1>',               // 2
  'const a = 1;',                 // 3
  '// </region:r1>',              // 4
  'const mid = 2;',               // 5
  '// <region:r2>',               // 6
  'const b = 3;',                 // 7
  '// </region:r2>',              // 8
  '',
].join('\n');
const L1 = '// atm-edit c-i1 by agent:x';
const L2 = '// atm-edit c-i2 by agent:y';
const L3 = '// atm-edit c-i3 by agent:z';
const ins = (id, region, line, seq, t = 'commit') => ({ logical_id: `log:c:${id}`, intent_id: id, kind: 'insert', region, line, token: line.split(' by ')[0].slice(3), terminal_outcome: t, commit_seq: seq });
const J = (...l) => l.join('\n');

const CASES = [
  { id: 'C0_positive_control', review_item: 'control', desc: '兩個合法插入，各在自己 region；最終 bytes 與手寫期望完全相同',
    ops: [ins('c-i1', 'r1', L1, 1), ins('c-i2', 'r2', L2, 2)],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', L2, '// </region:r2>', ''),
    final: null, // = expected_full
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'correct', 'c-i2': 'correct' } },
  { id: 'C1_marker_ok_neighbour_corrupted', review_item: '1 所有 marker 正確，但未授權的鄰近原文被改壞', desc: 'marker 都在且位置正確，但 const mid = 2 被改成 3',
    ops: [ins('c-i1', 'r1', L1, 1), ins('c-i2', 'r2', L2, 2)],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', L2, '// </region:r2>', ''),
    final: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, '// </region:r1>', 'const mid = 3;', '// <region:r2>', 'const b = 3;', L2, '// </region:r2>', ''),
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'frame_violation', 'c-i2': 'frame_violation' } },
  { id: 'C2_effect_misplaced', review_item: '2 正確效果被放錯位置', desc: 'c-i1 應在 r1，實際落在 r2',
    ops: [ins('c-i1', 'r1', L1, 1)],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    final: J('// fixture header', '// <region:r1>', 'const a = 1;', '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', L1, '// </region:r2>', ''),
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'misplaced' } },
  { id: 'C3_region_tag_missing', review_item: '3 缺 region 標籤', desc: 'marker 在，但 r1 的結束標籤被刪掉',
    ops: [ins('c-i1', 'r1', L1, 1)],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    final: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'region_missing' } },
  { id: 'C4_effect_duplicated', review_item: '4 相同效果重複出現', desc: 'c-i1 在 r1 出現兩次',
    ops: [ins('c-i1', 'r1', L1, 1)],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    final: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, L1, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'duplicate' } },
  { id: 'C5a_legal_delete', review_item: '5 合法刪除／替換，不應因 marker 消失而誤判', desc: 'c-i1 插入後，已提交的 c-i2 合法刪除該行；最終＝base',
    ops: [ins('c-i1', 'r1', L1, 1), { logical_id: 'log:c:c-i2', intent_id: 'c-i2', kind: 'delete', region: 'r1', target_line: L1, line: null, terminal_outcome: 'commit', commit_seq: 2 }],
    expected_full: BASE, final: null,
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'superseded', 'c-i2': 'correct' } },
  { id: 'C5b_legal_replace_of_original', review_item: '5 合法刪除／替換，不應因 marker 消失而誤判', desc: '已提交的 c-i3 把原文 const b = 3; 合法替換',
    ops: [{ logical_id: 'log:c:c-i3', intent_id: 'c-i3', kind: 'replace', region: 'r2', target_line: 'const b = 3;', line: 'const b = 4; ' + L3, terminal_outcome: 'commit', commit_seq: 1 }],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 4; ' + L3, '// </region:r2>', ''),
    final: null,
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 8],
    expect: { 'c-i3': 'correct' } },
  { id: 'C6_legal_supersede', review_item: '6 合法後續操作取代先前效果，不應算成 lost', desc: 'c-i1 插入後，已提交的 c-i2 把 c-i1 那行換成自己的行',
    ops: [ins('c-i1', 'r1', L1, 1), { logical_id: 'log:c:c-i2', intent_id: 'c-i2', kind: 'replace', region: 'r1', target_line: L1, line: L2, terminal_outcome: 'commit', commit_seq: 2 }],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', L2, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    final: null,
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'superseded', 'c-i2': 'correct' } },
  { id: 'N5_illegal_disappearance', review_item: '5 的負例（無授權刪除）', desc: 'c-i1 已提交，沒有任何刪除操作，但最終檔沒有這行 → 必須是 lost',
    ops: [ins('c-i1', 'r1', L1, 1)],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    final: BASE,
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'lost' } },
  { id: 'N6_supersede_by_uncommitted', review_item: '6 的負例（取代者未提交）', desc: 'c-i2 被 blocked，但最終檔卻用 c-i2 取代了 c-i1 → c-i1 lost、c-i2 blocked_leak',
    ops: [ins('c-i1', 'r1', L1, 1), { logical_id: 'log:c:c-i2', intent_id: 'c-i2', kind: 'replace', region: 'r1', target_line: L1, line: L2, terminal_outcome: 'blocked', commit_seq: 2 }],
    expected_full: J('// fixture header', '// <region:r1>', 'const a = 1;', L1, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    final: J('// fixture header', '// <region:r1>', 'const a = 1;', L2, '// </region:r1>', 'const mid = 2;', '// <region:r2>', 'const b = 3;', '// </region:r2>', ''),
    unchanged_base_lines: [1, 2, 3, 4, 5, 6, 7, 8],
    expect: { 'c-i1': 'lost', 'c-i2': 'blocked_leak' } },
];

const baseLines = BASE.split('\n');
const results = [];
let allPass = true;
for (const c of CASES) {
  const final = c.final ?? c.expected_full;
  // 1) oracle's reference applier must reproduce the hand-written expected bytes
  let ref_matches_handwritten = null, ref_error = null;
  try { ref_matches_handwritten = referenceApply(BASE, c.ops.filter((o) => o.terminal_outcome === 'commit')).content === c.expected_full; }
  catch (e) { ref_error = String(e.message); }
  // 2) mask: listed base lines must survive unchanged & in order in the expected bytes
  const exp = c.expected_full.split('\n');
  let k = 0; const mask_ok = c.unchanged_base_lines.every((ln) => { const i = exp.indexOf(baseLines[ln - 1], k); if (i < 0) return false; k = i + 1; return true; });
  // 3) v2 verdicts
  const r = scoreFile({ path: 'case.ts', base: BASE, final, ops: c.ops });
  const actual = Object.fromEntries(r.rows.map((x) => [x.intent_id, x.verdict]));
  const verdicts_ok = Object.entries(c.expect).every(([id, v]) => actual[id] === v);
  // 4) what r1's presence-based oracle says (insert ops only; v1 has no replace/delete model)
  const v1 = Object.fromEntries(c.ops.map((o) => [o.intent_id, o.kind !== 'insert' ? 'n/a(no-op-kind)' : classifyEffect({
    effect: { logical_id: o.logical_id, intent_id: o.intent_id, path: 'case.ts', region: o.region, effect_id: `eff:${o.intent_id}`,
      token: o.token, exact_line: o.line, eligible: true }, content: final, terminal_outcome: o.terminal_outcome }).oracle_verdict]));
  const pass = verdicts_ok && ref_matches_handwritten === true && mask_ok;
  allPass &&= pass;
  results.push({ id: c.id, review_item: c.review_item, desc: c.desc,
    expected_full_digest: sha256(c.expected_full), final_digest: sha256(final), oracle_expected_digest: r.expected_digest,
    full_bytes_exact: r.full_bytes_exact, frame_ok: r.frame_ok, structure_ok: r.structure_ok, frame_first_diff: r.frame_first_diff,
    unchanged_base_lines: c.unchanged_base_lines, mask_ok, ref_matches_handwritten, ref_error,
    expected_verdicts: c.expect, actual_verdicts: actual, v1_verdicts: v1, pass,
    expected_full: c.expected_full, final });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'oracle_v2_contract_results.json'), JSON.stringify({ oracle_version: ORACLE_V2_VERSION, v1_version: V1, base: BASE, base_digest: sha256(BASE), all_pass: allPass, cases: results }, null, 2) + '\n');
const md = [
  '# Oracle v2 契約案例結果（r2 P0-2）', '',
  `oracle：\`${ORACLE_V2_VERSION}\`；對照 r1：\`${V1}\`。全部通過：**${allPass}**。`, '',
  '每例：手寫獨立 expected full bytes（sha256 見 JSON）、未變行 mask、期待 verdict、實際 verdict；並檢查 oracle 自己的 reference applier 是否重現手寫 bytes。這些是不同契約路徑的覆蓋，不是統計獨立樣本。', '',
  '| case | 審核項目 | 期待 (v2) | 實際 (v2) | r1 presence oracle | frame | structure | ref=手寫 | mask | pass |',
  '|------|----------|-----------|-----------|--------------------|-------|-----------|----------|------|------|',
  ...results.map((x) => `| ${x.id} | ${x.review_item} | ${JSON.stringify(x.expected_verdicts)} | ${JSON.stringify(x.actual_verdicts)} | ${JSON.stringify(x.v1_verdicts)} | ${x.frame_ok} | ${x.structure_ok} | ${x.ref_matches_handwritten} | ${x.mask_ok} | ${x.pass ? '✅' : '❌'} |`),
  '',
].join('\n');
writeFileSync(join(OUT, 'ORACLE_V2_CONTRACT.md'), md);
console.log(md);
process.exit(allPass ? 0 : 1);
