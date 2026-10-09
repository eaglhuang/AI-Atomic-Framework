// Forensic repro (single writer, no concurrency): apply writer 26412's actuator.py hunks via the steward path
// (unifiedPatch -> composeBrokerProposals -> applyStewardPlan) and via `git apply`, compare with the oracle's expected bytes.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { tmpdir } from 'node:os'; import { spawnSync } from 'node:child_process';
import { applyBaseHunks, relocateHunks, sha256, toLines, unifiedPatch } from '/workspace/reports/atm-v2-harness/src/hist/patchkit.mjs';
import { initWorktreeGit, ComposeWindowManager } from '/workspace/reports/atm-v2-harness/src/steward-writer.mjs';
const pairId = process.argv[2], wIdx = Number(process.argv[3]), path = process.argv[4];
const pair = readFileSync('/workspace/reports/hist-main/prereg/sample/pairs_main.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).find((p) => p.pair_id === pairId);
const W = pair.writers[wIdx]; const hunks = W.hunks.filter((h) => h.path === path); const base = pair.base_text[path];
const expected = applyBaseHunks(toLines(base), hunks).join('');
const wt = mkdtempSync(join(tmpdir(), 'repro-eof-')); mkdirSync(dirname(join(wt, path)), { recursive: true }); writeFileSync(join(wt, path), base);
const head = initWorktreeGit(wt);
const L = toLines(base); const rel = relocateHunks(L, hunks, L.length);
const blocks = rel.placements.map((p) => ({ s: p.s, e: p.e, post: hunks.find((h) => h.logical_id === p.logical_id).post }));
const patch = unifiedPatch(path, L, blocks); writeFileSync(join(wt, 'p.patch'), patch);
// git apply on a copy
const g = mkdtempSync(join(tmpdir(), 'repro-git-')); mkdirSync(dirname(join(g, path)), { recursive: true }); writeFileSync(join(g, path), base);
const ga = spawnSync('git', ['apply', '--unsafe-paths', join(wt, 'p.patch')], { cwd: g, encoding: 'utf8' });
const gitOut = readFileSync(join(g, path), 'utf8');
const windows = new ComposeWindowManager({ cwd: wt, artifactsDir: join(wt, '.art'), compose_window_ms: 10, evidenceTag: 'repro' }); await windows.ensureApi();
const proposalId = 'prop-repro';
const proposal = { schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: 'repro' }, proposalId, taskId: 'TASK-PROP-REPRO', actorId: 'writer-repro',
  baseCommit: windows.api.readGitHeadCommit(wt), fileBeforeHash: sha256(base), targetFile: path, atomRefs: [{ atomId: 'atom.repro', atomCid: 'cid.repro' }], anchors: [{ kind: 'line', hint: `L${blocks[0].s + 1}` }],
  intent: 'repro', patch, validators: [], rollback: 'discard' };
const res = await windows.submit({ targetFile: path, proposal, intent_id: proposalId, logical_id: proposalId, expectedCount: 1, expected_source: 'repro' });
const atmOut = readFileSync(join(wt, path), 'utf8');
const tail = (s) => JSON.stringify(s.slice(-60));
console.log(JSON.stringify({ atm_monorepo: process.env.ATM_MONOREPO, pair: pairId, writer: W.pr, path, patch_has_no_newline_marker: patch.includes('\\ No newline at end of file'),
  expected_ends_with_newline: expected.endsWith('\n'), steward_outcome: res.outcome, atm_equals_expected: atmOut === expected, git_apply_rc: ga.status, git_equals_expected: gitOut === expected,
  atm_minus_expected_bytes: atmOut.length - expected.length, expected_tail: tail(expected), atm_tail: tail(atmOut) }, null, 1));
process.exit(0);
