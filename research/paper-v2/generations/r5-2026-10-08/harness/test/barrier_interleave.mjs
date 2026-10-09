#!/usr/bin/env node
// r3: deterministic, barrier-controlled 2-process interleaving test for the steward "after check, before write" window.
// Harness-level only: ATM sources are NOT modified. The seam is a node:fs interception installed in each child
// (module.syncBuiltinESMExports) that blocks on the FIRST canonical-mutation syscall, i.e. the first
//   writeFileSync/openSync/renameSync whose path lies in the target file's directory (5692474f: the in-place canonical
//   write; bea35380: the same-dir temp sibling), or mkdirSync under atm-steward-commit-locks (bea35380 lock acquire).
// At both pins that point is after compose + the unlocked stale pre-check, and before any canonical byte changes.
// Schedule (forced): both processes compose against the same base B and reach the seam; LEADER proceeds and
// finishes applyStewardPlan; only then FOLLOWER proceeds. This is exactly the E4 r1/r2 lost-update interleaving.
// Usage: node test/barrier_interleave.mjs --atm <ATM_MONOREPO> --out <dir> [--reps N]
// Exit 0 always for a completed experiment; outcome is in <out>/barrier_result.json (pass/fail is per pin semantics).
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let FREGION = 'reducers'; let LREGION = 'reducers'; let MODE = 'seam';
// r4 --mode: seam (r3 default: both pause at first canonical-mutation syscall) | stale-proposal (follower proposal built on base B;
//   follower calls applyStewardPlan only after leader.done -> plan-stage path, r4 item (a)) | before-precheck (follower pauses in
//   ATM's forwarded commitHooks.beforePrecheck until leader.done -> unlocked early stale check, r4 item (b); 2118bc66+ only).
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const sha = (t) => `sha256:${createHash('sha256').update(t, 'utf8').digest('hex')}`;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const TARGET = 'src/store.ts';
const BASE = [
  '// fixture for r3 barrier test', 'export const store = {};', '// <region:reducers>', '// base reducer line',
  '// </region:reducers>', '// <region:selectors>', '// </region:selectors>', 'export default store;', '',
].join('\n');

async function child() {
  const role = arg('--child'), wt = arg('--wt'), bar = arg('--bar');
  const targetAbs = join(wt, TARGET); const targetDir = dirname(fs.realpathSync(targetAbs));
  const log = { role, pid: process.pid, seam_fired: false, seam_op: null, seam_path: null, t: {} };
  const t0 = Date.now(); const mark = (k) => { log.t[k] = Date.now() - t0; };
  const orig = { writeFileSync: fs.writeFileSync, openSync: fs.openSync, renameSync: fs.renameSync, mkdirSync: fs.mkdirSync };
  const touch = (n) => orig.writeFileSync(join(bar, n), String(process.pid));
  const waitFor = (names, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (names.every((n) => fs.existsSync(join(bar, n)))) return true; sleep(2); } return false; };
  const isCanonical = (op, p, flags) => {
    if (typeof p !== 'string') return false;
    const abs = resolve(p);
    if (op === 'mkdirSync') return /steward-commit-locks/.test(abs); // r4: bea35380 <tmp>/atm-steward-commit-locks; 2118bc66 <repo>/.atm/runtime/steward-commit-locks
    if (op === 'openSync' && !(typeof flags === 'string' && /[wa+]/.test(flags))) return false;
    try { return dirname(abs) === targetDir; } catch { return false; }
  };
  log.commit_guard_lock_acquires = 0; log.tx_attempts = 0; // bea35380: mkdir of <lockRoot>/<sha256(realpath)> = one canonical commit attempt
  const MODE_C = arg('--mode', 'seam');
  const seam = (op, p) => {
    if (log.seam_fired || MODE_C !== 'seam') return;
    log.seam_fired = true; log.seam_op = op; log.seam_path = p.startsWith(wt) ? p.slice(wt.length + 1) : basename(dirname(p)) + '/' + basename(p);
    // Read BEFORE signalling arrival: no process can mutate the target until both have arrived.
    log.disk_hash_at_seam = sha(fs.readFileSync(targetAbs, 'utf8'));
    mark('seam_arrive'); touch(`arrive.${role}`);
    log.both_arrived = waitFor(['arrive.leader', 'arrive.follower'], 15000); mark('both_arrived');
    if (role === 'follower') { log.leader_done_seen = waitFor(['leader.done'], 15000); mark('follower_release'); }
  };
  for (const op of ['writeFileSync', 'openSync', 'renameSync', 'mkdirSync']) {
    fs[op] = function (...a) {
      const p = op === 'renameSync' ? a[1] : a[0];
      if (isCanonical(op, String(p), a[1])) seam(op, String(p));
      const r = orig[op].apply(this, a);
      if (op === 'mkdirSync' && /steward-commit-locks\/[0-9a-f]{64}$/.test(String(p)) && !a[1]?.recursive) log.commit_guard_lock_acquires += 1;
      if (op === 'writeFileSync' && /steward-commit-locks\/[0-9a-f]{64}\/owner$/.test(String(p))) log.lock_owner_writes = (log.lock_owner_writes || 0) + 1; // r5: lock acquisitions at every guarded pin
      return r;
    };
  }
  syncBuiltinESMExports();
  const { makeMarkerProposal } = await import(pathToFileURL(join(HERE, '../src/steward-writer.mjs')).href);
  const { atmCoreBroker } = await import(pathToFileURL(join(HERE, '../src/atm-resolve.mjs')).href);
  const [{ composeBrokerProposals }, { applyStewardPlan, readGitHeadCommit }] = await Promise.all([
    import(pathToFileURL(atmCoreBroker('compose.ts')).href), import(pathToFileURL(atmCoreBroker('steward.ts')).href)]);
  const content = fs.readFileSync(targetAbs, 'utf8'); log.compose_base_hash = sha(content);
  const intentId = `barrier-${role}`;
  const region = role === 'follower' ? (arg('--fregion') || 'reducers') : (arg('--lregion') || 'reducers');
  const proposal = makeMarkerProposal({ proposalId: `p-${role}`, actorId: `agent-${role}`, targetFile: TARGET, region,
    content, baseCommit: readGitHeadCommit(wt), intentId });
  touch(`ready.${role}`); log.both_ready = waitFor(['ready.leader', 'ready.follower'], 15000); mark('both_ready');
  let result, thrown = null;
  if (MODE_C === 'stale-proposal' && role === 'follower') { log.paused = true; log.leader_done_seen = waitFor(['leader.done'], 15000); log.disk_hash_at_resume = sha(fs.readFileSync(targetAbs, 'utf8')); mark('follower_release'); }
  const prePause = () => { log.tx_attempts += 1; if (MODE_C === 'before-precheck' && role === 'follower' && !log.paused) { log.paused = true; touch('paused.follower'); log.leader_done_seen = waitFor(['leader.done'], 15000); log.disk_hash_at_resume = sha(fs.readFileSync(targetAbs, 'utf8')); mark('follower_release'); } };
  // r4 v2: in before-precheck mode the leader starts only after the follower is paused inside ATM (after ATM's own compose,
  // before the unlocked precheck), so the leader's commit always lands in exactly that window.
  if (MODE_C === 'before-precheck' && role === 'leader') { log.follower_paused_seen = waitFor(['paused.follower'], 15000); mark('leader_release'); }
  try {
    const composed = composeBrokerProposals([proposal]);
    result = applyStewardPlan({ cwd: wt, stewardId: 'neutral-write-steward', mergePlan: composed.mergePlan, proposals: [proposal],
      scopeFiles: [TARGET], evidenceOutPath: join(bar, `evidence.${role}.json`),
      commitHooks: { beforePrecheck: prePause } }); // r4: counter (+ follower pause in before-precheck mode); 2118bc66+ forwards it
  } catch (e) { thrown = String(e?.message || e); }
  mark('apply_return');
  if (role === 'leader') touch('leader.done');
  const ev = result?.evidence ?? {};
  Object.assign(log, { ok: !!result?.ok, verdict: ev.verdict ?? 'thrown', blockedReasons: ev.blockedReasons ?? (thrown ? [thrown] : []),
    receipt_before: ev.fileBeforeHashes?.[TARGET] ?? null, receipt_after: ev.fileAfterHashes?.[TARGET] ?? null,
    marker: proposal.patch.split('\n').find((l) => l.startsWith('+//') && !l.includes('</region:')).slice(1) });
  process.stdout.write(JSON.stringify(log) + '\n');
}

function runChild(role, wt, bar, atm) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', role, '--wt', wt, '--bar', bar, '--fregion', FREGION, '--lregion', LREGION, '--mode', MODE],
      { env: { ...process.env, ATM_MONOREPO: atm }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { let j = null; try { j = JSON.parse(out.trim().split('\n').pop()); } catch {} res({ code, j, err: err.slice(-2000) }); });
  });
}

async function parent() {
  const atm = resolve(arg('--atm')); const out = resolve(arg('--out')); const reps = Number(arg('--reps', '10')); FREGION = arg('--fregion', 'reducers'); LREGION = arg('--lregion', 'reducers'); MODE = arg('--mode', 'seam');
  fs.mkdirSync(out, { recursive: true });
  const { initWorktreeGit } = await import(pathToFileURL(join(HERE, '../src/steward-writer.mjs')).href);
  const pinSha = (atm.match(/[0-9a-f]{40}/) || [null])[0];
  const runs = [];
  for (let r = 1; r <= reps; r++) {
    const base = fs.mkdtempSync(join(tmpdir(), 'r3-barrier-')); const wt = join(base, 'wt'), bar = join(base, 'bar');
    fs.mkdirSync(join(wt, 'src'), { recursive: true }); fs.mkdirSync(bar);
    fs.writeFileSync(join(wt, TARGET), BASE); initWorktreeGit(wt);
    const [L, F] = await Promise.all([runChild('leader', wt, bar, atm), runChild('follower', wt, bar, atm)]);
    const final = fs.readFileSync(join(wt, TARGET), 'utf8');
    const leftovers = fs.readdirSync(join(wt, 'src')).filter((n) => n !== 'store.ts');
    const l = L.j || {}, f = F.j || {};
    const has = (m) => !!m && final.split('\n').includes(m);
    const withLine = (lines, reg = LREGION, src = BASE) => { const a = src.split('\n'); const i = a.indexOf(`// </region:${reg}>`); a.splice(i, 0, ...lines); return a.join('\n'); };
    const leaderOnly = withLine([l.marker]);
    const bothDisjoint = FREGION !== LREGION && f.marker ? withLine([f.marker], FREGION, leaderOnly) : null;
    const rec = {
      rep: r, leader: l, follower: f, leader_exit: L.code, follower_exit: F.code, stderr: { leader: L.err, follower: F.err },
      window_hit: MODE === 'seam' ? !!(l.seam_fired && f.seam_fired && l.both_arrived && f.both_arrived && f.leader_done_seen
        && l.disk_hash_at_seam === sha(BASE) && f.disk_hash_at_seam === sha(BASE) && l.compose_base_hash === sha(BASE) && f.compose_base_hash === sha(BASE))
        : !!(f.paused && f.leader_done_seen && f.compose_base_hash === sha(BASE) && f.disk_hash_at_resume && f.disk_hash_at_resume !== sha(BASE)
          && (MODE !== 'before-precheck' || l.follower_paused_seen)),
      final_hash: sha(final), final_bytes: Buffer.byteLength(final), leftover_files: leftovers,
      leader_marker_present: has(l.marker), follower_marker_present: has(f.marker),
      final_equals_leader_only: final === leaderOnly,
      final_equals_both_full_bytes: bothDisjoint !== null && final === bothDisjoint,
    };
    // Lost effect: a process reported `applied` but its effect is absent from the final bytes.
    rec.lost_effects = [l, f].filter((x) => x.verdict === 'applied' && !has(x.marker)).map((x) => x.role);
    const fAcq = Math.max(f.commit_guard_lock_acquires || 0, f.lock_owner_writes || 0); // r5: kernel-lock pins create the lock dir recursively
    rec.follower_class = f.verdict === 'applied' ? (has(f.marker) && has(l.marker)
        ? (Math.max(fAcq, f.tx_attempts) >= 2 ? 'applied_after_re-compose_both_present' : 'applied_both_present') : 'applied_overwrite')
      : (String(f.blockedReasons?.[0] || '').startsWith('re-compose:') ? 'blocked_re-compose'
        : String(f.blockedReasons?.[0] || '').startsWith('recovery-required:') ? 'blocked_recovery-required'
        : /^re-compose attempts exhausted/.test(String(f.blockedReasons?.[0] || '')) ? 'blocked_re-compose_exhausted'
        : /stale/.test(String(f.blockedReasons?.[0] || '')) ? 'blocked_stale_precheck'
        : (fAcq >= 1 && String(f.blockedReasons?.[0] || '').startsWith('steward-final-patch-required'))
          ? 'blocked_after_re-compose(steward-final-patch-required)'
        : (fAcq >= 1 && String(f.blockedReasons?.[0] || '').startsWith('compose-context-mismatch'))
          ? 'blocked_after_re-compose(compose-context-mismatch)' : 'blocked_other');
    runs.push(rec); fs.rmSync(base, { recursive: true, force: true });
    process.stderr.write(`rep ${r}: window_hit=${rec.window_hit} leader=${l.verdict} follower=${f.verdict}/${rec.follower_class} lost=${JSON.stringify(rec.lost_effects)}\n`);
  }
  const summary = {
    test: 'r3-barrier-interleave-v1', mode: MODE, atm_env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('ATM_STEWARD_'))), variant: FREGION === LREGION ? `same-region(${LREGION})` : `leader-${LREGION}/follower-${FREGION}`, atm_monorepo: atm, atm_pin: pinSha, node: process.version, reps,
    window_hit: runs.filter((x) => x.window_hit).length,
    runs_with_lost_effect: runs.filter((x) => x.lost_effects.length).length,
    lost_effects_total: runs.reduce((s, x) => s + x.lost_effects.length, 0),
    leader_applied: runs.filter((x) => x.leader.verdict === 'applied').length,
    follower_classes: runs.reduce((m, x) => { m[x.follower_class] = (m[x.follower_class] || 0) + 1; return m; }, {}),
    final_equals_leader_only: runs.filter((x) => x.final_equals_leader_only).length,
    final_equals_both_full_bytes: runs.filter((x) => x.final_equals_both_full_bytes).length,
    leftover_files: runs.reduce((s, x) => s + x.leftover_files.length, 0),
    seam_ops: [...new Set(runs.flatMap((x) => [x.leader.seam_op, x.follower.seam_op]))],
    follower_commit_guard_attempts: [...new Set(runs.map((x) => x.follower.commit_guard_lock_acquires))],
    leader_commit_guard_attempts: [...new Set(runs.map((x) => x.leader.commit_guard_lock_acquires))],
    follower_tx_attempts: [...new Set(runs.map((x) => x.follower.tx_attempts))],
    follower_lock_owner_writes: [...new Set(runs.map((x) => x.follower.lock_owner_writes || 0))],
    first_follower_reason: runs[0]?.follower?.blockedReasons?.[0] ?? null,
  };
  fs.writeFileSync(join(out, 'barrier_result.json'), JSON.stringify({ summary, runs }, null, 1));
  console.log(JSON.stringify(summary));
}

if (arg('--child')) await child(); else await parent();
