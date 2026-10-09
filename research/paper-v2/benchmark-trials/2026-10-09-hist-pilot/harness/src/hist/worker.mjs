#!/usr/bin/env node
// HIST writer process: one OS process per PR (writer). Shares the worktree with the other writer.
// argv: --run-dir D --writer K. Reads D/run.json (pair writer hunks, arm, seed params).
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { applyBaseHunks, relocateHunks, sha256, toLines, unifiedPatch } from './patchkit.mjs';

const { values: o } = parseArgs({ options: { 'run-dir': { type: 'string' }, writer: { type: 'string' } } });
const runDir = o['run-dir'], K = Number(o.writer);
const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
const wt = join(runDir, 'worktree');
const W = run.writers[K];
const arm = run.arm;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const SAB = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => Atomics.wait(SAB, 0, 0, ms);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32((run.seed ^ Math.imul(K + 1, 0x9E3779B1)) >>> 0);
const startOffset = Math.floor(rnd() * (run.params.start_jitter_ms + 1));
const byFile = new Map();
for (const h of W.hunks) { if (!byFile.has(h.path)) byFile.set(h.path, []); byFile.get(h.path).push(h); }
const files = [...byFile.keys()].sort();
for (let i = files.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [files[i], files[j]] = [files[j], files[i]]; }
const holds = Object.fromEntries(files.map((f) => [f, Math.floor(rnd() * (run.params.hold_max_ms + 1))]));
const baseText = run.base_text;

const readCur = (abs) => { try { return readFileSync(abs, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const writeAtomic = (abs, text) => { mkdirSync(dirname(abs), { recursive: true }); const tmp = `${abs}.tmp-hist-${process.pid}-${Math.random().toString(36).slice(2, 8)}`; writeFileSync(tmp, text); renameSync(tmp, abs); };
function withFileLock(path, fn) {   // cross-process O_EXCL lockfile (file_lock arm)
  const lock = join(wt, '.atm/runtime', `hist-filelock-${path.replace(/[^A-Za-z0-9]+/g, '_')}.lock`);
  let fd; let spins = 0;
  for (;;) { try { fd = openSync(lock, 'wx'); break; } catch (e) { if (e.code !== 'EEXIST') throw e; spins++; if (spins > 500000) throw new Error('file lock stuck'); sleepSync(0.2); } }
  try { return { r: fn(), spins }; } finally { closeSync(fd); rmSync(lock, { force: true }); }
}

let admit = null, windows = null, headCommit = null;
const tInit = performance.now();
if (arm !== 'bare_composer' && arm !== 'planted_raw_overwrite') { const { HistAdmit } = await import('./admit.mjs'); admit = await new HistAdmit(wt, run.params.admit ?? {}).init(); }
if (arm === 'steward' || arm === 'bare_composer') {
  const { ComposeWindowManager } = await import('../steward-writer.mjs');
  mkdirSync(join(runDir, 'artifacts'), { recursive: true });
  const batches = [];
  windows = new ComposeWindowManager({ cwd: wt, artifactsDir: join(runDir, 'artifacts'), compose_window_ms: run.params.compose_window_ms,
    evidenceTag: `w${K}`, onBatchClose: (ev) => batches.push(ev), onApplyTelemetry: (ev) => batches.push(ev) });
  windows._batches = batches;
  await windows.ensureApi();
  headCommit = windows.api.readGitHeadCommit(wt);
}
const init_ms = performance.now() - tInit;

const t0 = await new Promise((res) => { process.on('message', (m) => { if (m?.type === 'go') res(m.t0Epoch); }); process.send({ type: 'ready', pid: process.pid, init_ms }); });
await sleep(t0 + startOffset - Date.now());

const decisions = [];
for (const path of files) {
  const hunks = byFile.get(path);
  const abs = join(wt, path);
  const tS = performance.now();
  const rec = { writer: K, pr: W.pr, path, intents: hunks.map((h) => h.logical_id), hold_ms: holds[path], t_submit_epoch: Date.now() };
  let ticket = null;
  try {
    if (admit) {
      ticket = await admit.admit({ taskId: `TASK-HIST-W${K}-${path.replace(/[^A-Za-z0-9]+/g, '_')}`.toUpperCase(), actorId: `writer-${W.pr}`, path, hunks });
      Object.assign(rec, { atm_decision: ticket.decision, atm_disposition: ticket.atm_disposition, atm_first_disposition: ticket.atm_first_disposition, admit_wait_ms: ticket.wait_ms });
      if (!ticket.granted) { rec.outcome = 'blocked'; rec.blocked_reason = `atm-admission:${ticket.reason_code}`; continue; }
    }
    await sleep(holds[path]);
    if (arm === 'steward' || arm === 'bare_composer') {
      const cur = (readCur(abs) ?? ''); const L = toLines(cur);
      const rel = relocateHunks(L, hunks, toLines(baseText[path]).length);
      if (!rel.ok) { rec.outcome = 'blocked'; rec.blocked_reason = `harness-${rel.reason}`; continue; }
      const blocks = rel.placements.map((p) => ({ s: p.s, e: p.e, post: hunks.find((h) => h.logical_id === p.logical_id).post }));
      const proposalId = `prop-hist-w${K}-${path.replace(/[^A-Za-z0-9]+/g, '_')}`;
      const proposal = { schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: 'atm-bench hist' },
        proposalId, taskId: `TASK-${proposalId}`.replace(/[^A-Za-z0-9_-]/g, '_').toUpperCase(), actorId: `writer-${W.pr}`, baseCommit: headCommit,
        fileBeforeHash: sha256(cur), targetFile: path, atomRefs: [{ atomId: `atom.${proposalId}`, atomCid: `cid.${proposalId}` }],
        anchors: [{ kind: 'line', hint: `L${blocks[0].s + 1}` }], intent: `hist PR ${W.pr} ${path}`, patch: run.base_exists[path] === false && readCur(abs) === null ? unifiedPatch(path, L, blocks).replace(`--- a/${path}`, '--- /dev/null') : unifiedPatch(path, L, blocks), validators: [], rollback: 'discard' };
      const res = await windows.submit({ targetFile: path, proposal, intent_id: proposalId, logical_id: proposalId, expectedCount: 1, expected_source: 'hist_single_writer_per_process' });
      rec.outcome = res.outcome; rec.blocked_reason = res.outcome === 'commit' ? null : `${res.blocked_reason ?? 'steward_blocked'}`;
      Object.assign(rec, { steward_verdict: res.steward_verdict, blocked_reasons: res.blocked_reasons, compose_verdict: res.compose_verdict, batch_id: res.batch_id });
    } else if (arm === 'file_lock') {
      const { r, spins } = withFileLock(path, () => {
        const cur = (readCur(abs) ?? ''); const rel = relocateHunks(toLines(cur), hunks, toLines(baseText[path]).length);
        if (!rel.ok) return { ok: false, reason: rel.reason };
        writeAtomic(abs, rel.lines.join('')); return { ok: true };
      });
      rec.lock_spins = spins; rec.outcome = r.ok ? 'commit' : 'blocked'; rec.blocked_reason = r.ok ? null : `harness-${r.reason}`;
    } else if (arm === 'occ') {
      let retries = 0; rec.outcome = null;
      for (;;) {
        const cur = (readCur(abs) ?? ''); const v = sha256(cur);
        const rel = relocateHunks(toLines(cur), hunks, toLines(baseText[path]).length);
        if (!rel.ok) { rec.outcome = 'blocked'; rec.blocked_reason = `occ-${rel.reason}`; break; }
        await sleep(0);   // yield (r1-r5 OCC semantics: version re-check then write; check->rename window remains)
        if (sha256((readCur(abs) ?? '')) !== v) { retries++; if (retries > run.params.occ_max_retries) { rec.outcome = 'blocked'; rec.blocked_reason = 'occ-retries-exhausted'; break; } continue; }
        writeAtomic(abs, rel.lines.join('')); rec.outcome = 'commit'; break;
      }
      rec.occ_retries = retries;
    } else if (arm === 'git_three_way') {
      const mine = applyBaseHunks(toLines(baseText[path]), hunks).join('');
      const cur = (readCur(abs) ?? '');
      const td = mkdtempSync(join(tmpdir(), 'hist-g3-'));
      writeFileSync(join(td, 'ours'), cur); writeFileSync(join(td, 'base'), baseText[path]); writeFileSync(join(td, 'theirs'), mine);
      const m = spawnSync('git', ['merge-file', '-p', join(td, 'ours'), join(td, 'base'), join(td, 'theirs')], { encoding: 'utf8' });
      rmSync(td, { recursive: true, force: true });
      if (m.status !== 0) { rec.outcome = 'blocked'; rec.blocked_reason = m.status > 0 ? 'git-merge-conflict' : 'git-merge-error'; }
      else if (sha256((readCur(abs) ?? '')) !== sha256(cur)) { rec.outcome = 'blocked'; rec.blocked_reason = 'git-base-drift'; }
      else { writeAtomic(abs, m.stdout); rec.outcome = 'commit'; }
    } else if (arm === 'planted_raw_overwrite') {
      // PLANTED FAULT (oracle validation only, not an arm): stale read of base, blind overwrite => deterministic lost update.
      writeAtomic(abs, applyBaseHunks(toLines(baseText[path]), hunks).join('')); rec.outcome = 'commit';
    } else throw new Error(`unknown arm ${arm}`);
  } catch (e) { rec.outcome = 'error'; rec.blocked_reason = `exception:${e.code ?? ''}:${String(e.message).slice(0, 300)}`; }
  finally { try { ticket?.release?.(); } catch (e) { rec.release_error = String(e.message); } rec.total_ms = Math.round((performance.now() - tS) * 100) / 100; rec.t_done_epoch = Date.now(); decisions.push(rec); }
}
writeFileSync(join(runDir, `writer-${K}.json`), JSON.stringify({ writer: K, pr: W.pr, pid: process.pid, init_ms, start_offset_ms: startOffset, file_order: files, holds,
  decisions, admit_stats: admit?.stats ?? null, steward_batches: windows?._batches ?? null }, null, 1));
process.send({ type: 'done' }); process.disconnect?.();
