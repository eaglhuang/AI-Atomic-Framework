// HIST run driver: one (pair, arm, seed) run = 2 writer processes on one shared worktree, then oracle_v2-hist.
import { fork, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreHistRun, ORACLE_HIST_VERSION } from './oracle_hist.mjs';
import { applyBaseHunks, sha256, toLines, PATCHKIT_VERSION } from './patchkit.mjs';
import { initWorktreeGit } from '../steward-writer.mjs';
import { loadAtmApis } from '../real-broker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HARNESS_ROOT = join(HERE, '../..');
export const HIST_ARMS = ['steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer'];
export const PLANTS = ['planted_raw_overwrite', 'plant_revert_hunk', 'plant_flip_frame_byte', 'plant_torn_tail', 'plant_foreign_file'];
export const DEFAULT_PARAMS = { start_jitter_ms: 20, hold_max_ms: 30, compose_window_ms: 100, occ_max_retries: 8, admit: { queue_timeout_ms: 2000, poll_ms: 3 }, worker_timeout_ms: 180000 };

export function seedFor(pair_id, k) { return createHash('sha256').update(`hist-v1|${pair_id}|${k}`).digest().readUInt32BE(0); }

function walk(root, d = root, out = []) {
  for (const f of readdirSync(d)) {
    const p = join(d, f); const rel = relative(root, p);
    if (rel === '.git' || rel === '.atm') continue;
    if (statSync(p).isDirectory()) walk(root, p, out); else out.push(rel);
  }
  return out;
}

/** structure check: if base, b+A, b+B all ast.parse, final must too. */
function structureCheck(items) {
  const py = `import ast,json,sys\nout={}\nfor k,v in json.load(sys.stdin).items():\n  def ok(t):\n    try: ast.parse(t); return True\n    except Exception: return False\n  pre=all(ok(v[x]) for x in ('base','a','b'))\n  out[k]={'applicable':pre,'final_parses':ok(v['final']) if pre else None}\nprint(json.dumps(out))`;
  const r = spawnSync('python3', ['-c', py], { input: JSON.stringify(items), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`structure check failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

export async function runOne({ pair, arm, seedK, outDir, params = DEFAULT_PARAMS, plant = null, nodeBin = process.execPath }) {
  const seed = seedFor(pair.pair_id, seedK);
  const runDir = outDir; if (existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
  const wt = join(runDir, 'worktree'); mkdirSync(wt, { recursive: true });
  for (const [p, t] of Object.entries(pair.base_text)) { if (pair.base_exists?.[p] === false) continue; mkdirSync(dirname(join(wt, p)), { recursive: true }); writeFileSync(join(wt, p), t); }
  const head = initWorktreeGit(wt);
  const workerArm = plant === 'planted_raw_overwrite' ? 'planted_raw_overwrite' : arm;
  if (workerArm !== 'bare_composer' && workerArm !== 'planted_raw_overwrite') {
    const api = await loadAtmApis(); const reg = join(wt, '.atm/runtime/write-broker.registry.json');
    mkdirSync(dirname(reg), { recursive: true });
    api.saveRegistry(reg, api.createEmptyBrokerRegistryDocument({ repoId: 'atm-bench-hist', workspaceId: 'hist-worktree' }));
  }
  const run = { pair_id: pair.pair_id, stratum: pair.stratum, arm: workerArm, plant, seed_k: seedK, seed, params, head,
    writers: pair.writers.map((w) => ({ pr: w.pr, hunks: w.hunks })), base_text: pair.base_text, base_exists: pair.base_exists ?? {} };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run));
  const t0 = Date.now();
  const kids = [0, 1].map((k) => fork(join(HERE, 'worker.mjs'), ['--run-dir', runDir, '--writer', String(k)],
    { cwd: HARNESS_ROOT, execPath: nodeBin, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env } }));
  const logs = ['', '']; kids.forEach((c, k) => { c.stdout.on('data', (d) => { logs[k] += d; }); c.stderr.on('data', (d) => { logs[k] += d; }); });
  const exits = kids.map((c) => new Promise((res) => c.on('exit', (code, sig) => res({ code, sig }))));
  let timedOut = false;
  const ready = await Promise.race([Promise.all(kids.map((c) => new Promise((res, rej) => { c.on('message', (m) => { if (m?.type === 'ready') res(m); }); c.on('exit', (code) => rej(new Error(`worker exit before ready ${code}`))); }))),
    new Promise((_, rej) => setTimeout(() => rej(new Error('ready timeout')), 60000))]).catch((e) => ({ error: String(e.message) }));
  if (!ready.error) { const go = Date.now() + 100; kids.forEach((c) => c.send({ type: 'go', t0Epoch: go })); }
  const timer = setTimeout(() => { timedOut = true; kids.forEach((c) => c.kill('SIGKILL')); }, params.worker_timeout_ms);
  const exitInfo = await Promise.all(exits); clearTimeout(timer);
  const wall_ms = Date.now() - t0;
  const writers = [0, 1].map((k) => { try { return JSON.parse(readFileSync(join(runDir, `writer-${k}.json`), 'utf8')); } catch { return null; } });
  writeFileSync(join(runDir, 'worker_logs.txt'), logs.map((l, k) => `--- writer ${k}\n${l}`).join('\n'));

  // post-hoc PLANTED faults (oracle validation): mutate final bytes AFTER the run, acks unchanged
  const plantLog = [];
  const allHunks = pair.writers.flatMap((w, k) => w.hunks.map((h) => ({ ...h, writer: k })));
  if (plant && plant !== 'planted_raw_overwrite') {
    const common = pair.common_files[0]; const abs = join(wt, common); let text = readFileSync(abs, 'utf8');
    if (plant === 'plant_revert_hunk') {   // undo one acked hunk of writer 1 on the common file (simulated lost update)
      const h = allHunks.find((x) => x.writer === 1 && x.path === common && x.post.length > 0) ?? allHunks.find((x) => x.writer === 1 && x.path === common);
      const L = toLines(text); const blk = h.post.join(''); const idx = text.indexOf(blk);
      if (h.post.length && idx >= 0) text = text.slice(0, idx) + h.pre.join('') + text.slice(idx + blk.length);
      else { const b = toLines(pair.base_text[common]); text = applyBaseHunks(b, allHunks.filter((x) => x.path === common && x !== h && x.writer === 0)).join(''); }
      plantLog.push({ plant, path: common, logical_id: h.logical_id, changed: L.join('') !== text });
    } else if (plant === 'plant_flip_frame_byte') {   // corrupt one base line far from every hunk
      const L = toLines(text); const touched = new Set(allHunks.filter((x) => x.path === common).flatMap((x) => x.post));
      const i = L.findIndex((l, j) => j > 5 && l.trim().length > 8 && !touched.has(l) && !l.includes('"""'));
      L[i] = L[i].replace(/[a-z]/, (c) => (c === 'x' ? 'y' : 'x')); text = L.join(''); plantLog.push({ plant, path: common, line: i + 1 });
    } else if (plant === 'plant_torn_tail') { text = text.slice(0, Math.floor(text.length * 0.7)); plantLog.push({ plant, path: common, kept_bytes: text.length }); }
    else if (plant === 'plant_foreign_file') {
      const other = Object.keys(pair.base_text).find((p) => pair.base_exists?.[p] !== false && !allHunks.some((x) => x.path === p)) ?? common;
      if (other !== common) { writeFileSync(join(wt, other), readFileSync(join(wt, other), 'utf8') + '# foreign\n'); plantLog.push({ plant, path: other, kind: 'untouched-file' }); }
      writeFileSync(join(wt, `.${common.split('/').pop()}.planted.atm-tmp`), 'x'); plantLog.push({ plant, path: `.${common.split('/').pop()}.planted.atm-tmp`, kind: 'orphan-tmp' });
    }
    if (plant !== 'plant_foreign_file') writeFileSync(abs, text);
  }

  // terminal outcomes per intent
  const term = new Map();
  for (const w of writers.filter(Boolean)) for (const d of w.decisions) for (const id of d.intents) term.set(id, { outcome: d.outcome, blocked_reason: d.blocked_reason });
  const hunks = allHunks.map((h) => ({ ...h, terminal_outcome: term.get(h.logical_id)?.outcome ?? null, blocked_reason: term.get(h.logical_id)?.blocked_reason ?? null }));
  const files = {}; for (const p of Object.keys(pair.base_text)) files[p] = { base: pair.base_text[p], final: existsSync(join(wt, p)) ? readFileSync(join(wt, p), 'utf8') : '' };
  const final_exists = Object.fromEntries(Object.keys(pair.base_text).map((p) => [p, existsSync(join(wt, p))]));
  const known = new Set(Object.keys(pair.base_text)); const extraFiles = walk(wt).filter((p) => !known.has(p));
  const res = scoreHistRun({ files, hunks, extraFiles });
  // structure (python ast)
  const items = {};
  for (const p of Object.keys(pair.base_text)) if (p.endsWith('.py')) {
    const b = toLines(pair.base_text[p]);
    items[p] = { base: pair.base_text[p], a: applyBaseHunks(b, pair.writers[0].hunks.filter((h) => h.path === p)).join(''), b: applyBaseHunks(b, pair.writers[1].hunks.filter((h) => h.path === p)).join(''), final: files[p].final };
  }
  const structure = structureCheck(items);
  const structure_violations = Object.entries(structure).filter(([, v]) => v.applicable && v.final_parses === false).map(([k]) => k);
  res.summary.structure_violations = structure_violations.length;
  if (structure_violations.length) res.summary.run_failed = true;
  const reasons = {}; for (const h of hunks.filter((x) => x.terminal_outcome !== 'commit')) { const r = h.blocked_reason ?? h.terminal_outcome ?? 'unresolved'; const key = String(r).split(':').slice(0, 2).join(':').slice(0, 80); reasons[key] = (reasons[key] || 0) + 1; }
  const result = { pair_id: pair.pair_id, stratum: pair.stratum, arm, plant, seed_k: seedK, seed, oracle_version: ORACLE_HIST_VERSION, patchkit_version: PATCHKIT_VERSION,
    atm_monorepo: process.env.ATM_MONOREPO ?? null, wall_ms, timed_out: timedOut, worker_exit: exitInfo, ready_error: ready.error ?? null,
    writers_ok: writers.every(Boolean), summary: res.summary, blocked_reasons: reasons, structure, structure_violations, foreign_writes: res.foreign_writes,
    extra_files: res.extra_files, plants: plantLog, base_exists: pair.base_exists ?? null, final_exists, files: res.files,
    final_digests: Object.fromEntries(Object.entries(files).map(([p, v]) => [p, sha256(v.final)])) };
  if (!result.writers_ok || timedOut) result.summary.run_failed = true;
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 1));
  writeFileSync(join(runDir, 'oracle_rows.jsonl'), res.rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  // forensics: keep final bytes of failing files; drop the bulky worktree + run.json copy of base texts
  if (result.summary.run_failed) { mkdirSync(join(runDir, 'final_failing'), { recursive: true }); for (const f of res.files.filter((x) => !x.full_bytes_exact || !x.frame_ok)) writeFileSync(join(runDir, 'final_failing', f.path.replace(/\//g, '__')), files[f.path].final); }
  // content-addressed store of final bytes (dedup) for the semantic endpoint
  const store = join(runDir, '..', '..', 'finals'); mkdirSync(store, { recursive: true });
  for (const [p, v] of Object.entries(files)) { const h = sha256(v.final).slice(7); if (!existsSync(join(store, h))) writeFileSync(join(store, h), v.final); }
  rmSync(wt, { recursive: true, force: true }); rmSync(join(runDir, 'run.json'), { force: true });
  return result;
}
