#!/usr/bin/env node
// r4: harness-level fault scenarios for the steward canonical-commit lock (ATM sources are NOT modified).
// Seams: node:fs interception in each child (module.syncBuiltinESMExports) on
//   writeFileSync(<lockRoot>/<sha256>/owner)  => "lock held" point (after-lock), and
//   renameSync(<temp>, <target>)              => "before-rename" point (inside lock, after base compare, temp fully written);
// plus ATM's forwarded `commitHooks.beforePrecheck` test seam (2118bc66+) for retry exhaustion only.
// Lock owner files are crafted by the parent only for the pid-reuse / live-holder simulations.
// Usage: node test/r4_fault_scenarios.mjs --pins <name=ATMROOT,...> --out <dir> [--reps N] [--only F1,F2,...]
// DRAFT evidence. Exit 0 for a completed experiment; outcomes in <out>/fault_results.json.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const sha = (t) => `sha256:${createHash('sha256').update(t, 'utf8').digest('hex')}`;
const hex = (t) => createHash('sha256').update(t).digest('hex');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const TARGET = 'src/store.ts';
const BASE = [
  '// fixture for r4 fault scenarios', 'export const store = {};', '// <region:reducers>', '// base reducer line',
  '// </region:reducers>', '// <region:selectors>', '// base selector line', '// </region:selectors>', 'export default store;', '',
].join('\n');

// ---------------------------------------------------------------- child
async function child() {
  const role = arg('--child'), wt = arg('--wt'), bar = arg('--bar'), region = arg('--region', 'reducers');
  const hold = arg('--hold', 'none'), holdMs = Number(arg('--hold-ms', '0')), holdWait = arg('--hold-wait-file', '');
  const injectK = Number(arg('--inject-k', '0')); const policy = arg('--policy', '');
  const targetAbs = join(wt, TARGET); const targetReal = fs.realpathSync(targetAbs);
  const log = { role, pid: process.pid, ns_pid_self: process.pid, hold, held: false, lock_acquires: 0, tx_attempts: 0, injected: 0, t: {} };
  const t0 = Date.now(); const mark = (k) => { log.t[k] = Date.now() - t0; };
  const orig = { writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, mkdirSync: fs.mkdirSync };
  const touch = (n) => orig.writeFileSync(join(bar, n), String(process.pid));
  const waitFor = (n, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fs.existsSync(join(bar, n))) return true; sleep(2); } return false; };
  const doHold = (point) => {
    if (log.held) return; log.held = true; log.hold_point = point; mark('hold_start'); touch(`holding.${role}`);
    if (holdMs < 0) { while (true) sleep(1000); }               // wait to be SIGKILLed
    log.hold_wait_satisfied = holdWait ? waitFor(holdWait, holdMs) : (sleep(holdMs), null); mark('hold_end');
  };
  fs.mkdirSync = function (...a) { const r = orig.mkdirSync.apply(this, a); if (/steward-commit-locks\/[0-9a-f]{64}$/.test(String(a[0])) && !a[1]?.recursive) log.lock_acquires += 1; return r; };
  fs.writeFileSync = function (...a) {
    const r = orig.writeFileSync.apply(this, a);
    if (hold === 'after-lock' && /steward-commit-locks\/[0-9a-f]{64}\/owner$/.test(String(a[0]))) doHold('after-lock');
    return r;
  };
  fs.renameSync = function (...a) {
    if (hold === 'before-rename' && resolve(String(a[1])) === targetReal) doHold('before-rename');
    return orig.renameSync.apply(this, a);
  };
  syncBuiltinESMExports();
  const { makeMarkerProposal } = await import(pathToFileURL(join(HERE, '../src/steward-writer.mjs')).href);
  const { atmCoreBroker } = await import(pathToFileURL(join(HERE, '../src/atm-resolve.mjs')).href);
  const [{ composeBrokerProposals }, { applyStewardPlan, readGitHeadCommit }] = await Promise.all([
    import(pathToFileURL(atmCoreBroker('compose.ts')).href), import(pathToFileURL(atmCoreBroker('steward.ts')).href)]);
  const content = fs.readFileSync(targetAbs, 'utf8'); log.compose_base_hash = sha(content);
  const proposal = makeMarkerProposal({ proposalId: `p-${role}`, actorId: `agent-${role}`, targetFile: TARGET, region, content,
    baseCommit: readGitHeadCommit(wt), intentId: `fault-${role}` });
  log.marker = proposal.patch.split('\n').find((l) => l.startsWith('+//') && !l.includes('</region:')).slice(1);
  if (arg('--start-wait-file')) waitFor(arg('--start-wait-file'), 15000);
  mark('apply_start');
  let result, thrown = null;
  const beforePrecheck = () => {   // counter; F5: simulated competing committed writer between compose and precheck
    log.tx_attempts += 1;
    if (injectK < 0 || log.injected < injectK) {
      const cur = fs.readFileSync(targetAbs, 'utf8').split('\n'); const i = cur.indexOf('// </region:selectors>');
      cur.splice(i, 0, `// injected competing line ${log.injected + 1}`); orig.writeFileSync(targetAbs, cur.join('\n')); log.injected += 1;
    }
  };
  try {
    const composed = composeBrokerProposals([proposal]);
    result = applyStewardPlan({ cwd: wt, stewardId: 'neutral-write-steward', mergePlan: composed.mergePlan, proposals: [proposal],
      scopeFiles: [TARGET], evidenceOutPath: join(bar, `evidence.${role}.json`), commitHooks: { beforePrecheck },
      ...(policy ? { recomposePolicy: JSON.parse(policy) } : {}) });
  } catch (e) { thrown = String(e?.stack || e); }
  mark('apply_return'); touch(`done.${role}`);
  const ev = result?.evidence ?? {};
  Object.assign(log, { ok: !!result?.ok, verdict: ev.verdict ?? 'thrown', blockedReasons: ev.blockedReasons ?? (thrown ? [thrown] : []) });
  process.stdout.write(JSON.stringify(log) + '\n');
}

// ---------------------------------------------------------------- parent helpers
function spawnChild(atm, role, wt, bar, o = {}) {
  const args = [fileURLToPath(import.meta.url), '--child', role, '--wt', wt, '--bar', bar, '--region', o.region || 'reducers', '--hold', o.hold || 'none',
    '--hold-ms', String(o.holdMs ?? 0)];
  if (o.holdWait) args.push('--hold-wait-file', o.holdWait);
  if (o.startWait) args.push('--start-wait-file', o.startWait);
  if (o.injectK) args.push('--inject-k', String(o.injectK));
  if (o.policy) args.push('--policy', JSON.stringify(o.policy));
  const env = { ...process.env, ATM_MONOREPO: atm, ...(o.tmp ? { TMPDIR: o.tmp } : {}) };
  const cmd = o.pidns ? 'unshare' : process.execPath; const full = o.pidns ? ['-Urpf', '--mount-proc', process.execPath, ...args] : args;
  const p = spawn(cmd, full, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res) => p.on('close', (code, sig) => { let j = null; try { j = JSON.parse(out.trim().split('\n').pop()); } catch {} res({ code, sig, j, err: err.slice(-1500) }); }));
  return { p, done };
}
const waitFile = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fs.existsSync(f)) return true; await new Promise((r) => setTimeout(r, 2)); } return false; };
function freshWorktree(initWorktreeGit, tag) {
  const base = fs.mkdtempSync(join(tmpdir(), `r4-fault-${tag}-`)); const wt = join(base, 'wt'), bar = join(base, 'bar'), tmp = join(base, 'tmp');
  fs.mkdirSync(join(wt, 'src'), { recursive: true }); fs.mkdirSync(bar); fs.mkdirSync(tmp);
  fs.writeFileSync(join(wt, TARGET), BASE); initWorktreeGit(wt);
  return { base, wt, bar, tmp };
}
function lockDirFor(pinName, wt, tmp) {
  const real = fs.realpathSync(join(wt, TARGET));
  return pinName === 'bea35380' ? join(tmp, 'atm-steward-commit-locks', hex(real)) : join(wt, '.atm/runtime/steward-commit-locks', hex(real));
}
function startToken(pid) { try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 1).trim().split(/\s+/)[19]; } catch { return null; } }
function finalState(wt, ...logs) {
  const final = fs.readFileSync(join(wt, TARGET), 'utf8'); const lines = final.split('\n');
  const has = (m) => !!m && lines.includes(m);
  const leftovers = fs.readdirSync(join(wt, 'src')).filter((n) => n !== 'store.ts');
  const lost = logs.filter((x) => x && x.verdict === 'applied' && !has(x.marker)).map((x) => x.role);
  return { final_hash: sha(final), leftover_files: leftovers, lost_effects: lost, present: Object.fromEntries(logs.filter(Boolean).map((x) => [x.role, has(x.marker)])),
    frame_ok: final.startsWith('// fixture for r4 fault scenarios') && final.endsWith('export default store;\n') };
}
const brief = (x) => x ? { verdict: x.verdict, reason: (x.blockedReasons?.[0] || '').slice(0, 160), tx_attempts: x.tx_attempts, lock_acquires: x.lock_acquires,
  injected: x.injected, held: x.held, hold_point: x.hold_point ?? null, hold_wait_satisfied: x.hold_wait_satisfied ?? null, apply_ms: (x.t.apply_return ?? 0) - (x.t.apply_start ?? 0) } : null;

// ---------------------------------------------------------------- scenarios
async function main() {
  const pins = Object.fromEntries(arg('--pins').split(',').map((kv) => kv.split('=')));
  const out = resolve(arg('--out')); const REPS = Number(arg('--reps', '10')); const only = arg('--only') ? arg('--only').split(',') : null;
  fs.mkdirSync(out, { recursive: true });
  const { initWorktreeGit } = await import(pathToFileURL(join(HERE, '../src/steward-writer.mjs')).href);
  const results = [];
  const record = (scenario, variant, pin, rep, rec) => { results.push({ scenario, variant, pin, rep, ...rec });
    process.stderr.write(`${scenario} ${variant} ${pin} r${rep}: ${JSON.stringify({ A: rec.A?.verdict, B: rec.B?.verdict, lost: rec.state?.lost_effects, left: rec.state?.leftover_files?.length })}\n`); };
  const want = (s) => !only || only.includes(s);

  for (const [pin, atm] of Object.entries(pins)) {
    // F1: holder SIGKILLed while holding the lock (after-lock / before-rename); B then applies.
    if (want('F1')) for (const point of ['after-lock', 'before-rename']) for (let r = 1; r <= REPS; r++) {
      const w = freshWorktree(initWorktreeGit, 'F1'); const tmp = w.tmp;
      const A = spawnChild(atm, 'A', w.wt, w.bar, { hold: point, holdMs: -1, tmp });
      const holding = await waitFile(join(w.bar, 'holding.A'), 15000);
      const lockDir = lockDirFor(pin, w.wt, tmp); const lockExistedAtKill = fs.existsSync(lockDir);
      A.p.kill('SIGKILL'); const a = await A.done;
      const leftAfterKill = fs.readdirSync(join(w.wt, 'src')).filter((n) => n !== 'store.ts');
      const t = Date.now(); const B = spawnChild(atm, 'B', w.wt, w.bar, { region: 'selectors', tmp }); const b = await B.done;
      record('F1-holder-sigkill', point, pin, r, { A_signal: a.sig, A_held: holding, lock_existed_at_kill: lockExistedAtKill, leftover_after_kill: leftAfterKill,
        B: brief(b.j), B_wall_ms: Date.now() - t, lock_dir_after: fs.existsSync(lockDir), state: finalState(w.wt, b.j), B_err: b.j ? null : b.err });
      fs.rmSync(w.base, { recursive: true, force: true });
    }
    // F2: crafted owner files (pid reuse = live pid with wrong start token; live holder with correct token; dead pid; legacy v1 live pid).
    if (want('F2')) for (const variant of ['pidreuse-live-pid-wrong-starttoken', 'live-pid-correct-starttoken', 'dead-pid', 'legacy-v1-live-pid']) for (let r = 1; r <= Math.min(REPS, 5); r++) {
      const w = freshWorktree(initWorktreeGit, 'F2'); const lockDir = lockDirFor(pin, w.wt, w.tmp); fs.mkdirSync(lockDir, { recursive: true });
      const sleeper = spawn('sleep', ['60'], { stdio: 'ignore' }); let pid = sleeper.pid, tok = startToken(sleeper.pid);
      if (variant === 'dead-pid') { const d = spawnSync('sh', ['-c', 'echo $$']); pid = Number(String(d.stdout).trim()); tok = '12345'; }
      if (variant === 'pidreuse-live-pid-wrong-starttoken') tok = String(Number(tok) + 777);
      const owner = variant === 'legacy-v1-live-pid' ? `${pid}\n` : (pin === 'bea35380' ? `${pid}\n` : `v2\n${pid}\n${tok}\nfeedfacefeedface\n`);
      fs.writeFileSync(join(lockDir, 'owner'), owner);
      const t = Date.now(); const B = spawnChild(atm, 'B', w.wt, w.bar, { tmp: w.tmp }); const b = await B.done; sleeper.kill('SIGKILL');
      record('F2-crafted-owner', variant, pin, r, { owner_format: owner.startsWith('v2') ? 'v2' : 'v1(pid only)', owner_pid_alive: variant !== 'dead-pid',
        B: brief(b.j), B_wall_ms: Date.now() - t, lock_dir_after: fs.existsSync(lockDir), state: finalState(w.wt, b.j), B_err: b.j ? null : b.err });
      fs.rmSync(w.base, { recursive: true, force: true });
    }
    // F3: live holder past lockWaitMs (2000 ms): A holds 3500 ms after acquiring; B must not write (recovery-required), A then commits.
    if (want('F3')) for (let r = 1; r <= REPS; r++) {
      const w = freshWorktree(initWorktreeGit, 'F3');
      const A = spawnChild(atm, 'A', w.wt, w.bar, { hold: 'after-lock', holdMs: 3500, tmp: w.tmp });
      await waitFile(join(w.bar, 'holding.A'), 15000);
      const t = Date.now(); const B = spawnChild(atm, 'B', w.wt, w.bar, { region: 'selectors', tmp: w.tmp });
      const [a, b] = await Promise.all([A.done, B.done]);
      record('F3-live-holder-timeout', 'hold3500ms', pin, r, { A: brief(a.j), B: brief(b.j), B_wall_ms: Date.now() - t, state: finalState(w.wt, a.j, b.j), errs: [a.j ? null : a.err, b.j ? null : b.err] });
      fs.rmSync(w.base, { recursive: true, force: true });
    }
    // F4: separate TMPDIR per process, one shared repo. Both pause before rename (inside their lock, after the base compare).
    // A waits <=800 ms for B to also reach that point; B then waits for A to finish. If the lock is not shared, both pass the compare.
    if (want('F4')) for (const tmpMode of ['same-tmpdir', 'different-tmpdir']) for (const bRegion of ['reducers', 'selectors']) for (let r = 1; r <= REPS; r++) {
      const w = freshWorktree(initWorktreeGit, 'F4'); const tA = join(w.base, 'tA'), tB = tmpMode === 'same-tmpdir' ? tA : join(w.base, 'tB');
      fs.mkdirSync(tA, { recursive: true }); fs.mkdirSync(tB, { recursive: true });
      const A = spawnChild(atm, 'A', w.wt, w.bar, { hold: 'before-rename', holdMs: 800, holdWait: 'holding.B', tmp: tA });
      await waitFile(join(w.bar, 'holding.A'), 15000);
      const B = spawnChild(atm, 'B', w.wt, w.bar, { region: bRegion, hold: 'before-rename', holdMs: 15000, holdWait: 'done.A', tmp: tB });
      const [a, b] = await Promise.all([A.done, B.done]);
      record('F4-tmpdir', `${tmpMode}/B-${bRegion === 'reducers' ? 'same-region' : 'other-region'}`, pin, r, { A: brief(a.j), B: brief(b.j), both_inside_lock: !!(a.j?.hold_wait_satisfied),
        state: finalState(w.wt, a.j, b.j), errs: [a.j ? null : a.err, b.j ? null : b.err] });
      fs.rmSync(w.base, { recursive: true, force: true });
    }
    // F6: separate PID namespace (unshare -Urpf --mount-proc), one shared repo + shared TMPDIR (real, not simulated).
    // The holder pauses before rename for <=2500 ms waiting for the other process to also get inside; the other then waits for the holder.
    if (want('F6')) for (const dir of ['holder-host/contender-pidns', 'holder-pidns/contender-host']) for (let r = 1; r <= REPS; r++) {
      const w = freshWorktree(initWorktreeGit, 'F6'); const tmp = w.tmp;
      const A = spawnChild(atm, 'A', w.wt, w.bar, { hold: 'before-rename', holdMs: 2500, holdWait: 'holding.B', tmp, pidns: dir.startsWith('holder-pidns') });
      await waitFile(join(w.bar, 'holding.A'), 15000);
      const B = spawnChild(atm, 'B', w.wt, w.bar, { region: 'selectors', hold: 'before-rename', holdMs: 15000, holdWait: 'done.A', tmp, pidns: dir.endsWith('contender-pidns') });
      const [a, b] = await Promise.all([A.done, B.done]);
      record('F6-pid-namespace', dir, pin, r, { A: brief(a.j), B: brief(b.j), both_inside_lock: !!(a.j?.hold_wait_satisfied), A_ns_pid: a.j?.pid ?? null, B_ns_pid: b.j?.pid ?? null,
        state: finalState(w.wt, a.j, b.j), errs: [a.j ? null : a.err, b.j ? null : b.err] });
      fs.rmSync(w.base, { recursive: true, force: true });
    }
    // F5: retry exhaustion. A competing write lands between compose and the unlocked precheck on the first K attempts (beforePrecheck seam).
    // F5 needs the forwarded beforePrecheck seam (2118bc66+); bea35380 ignores it => not exercisable there (skipped, reported N/A).
    if (want('F5') && pin !== 'bea35380') for (const [variant, injectK, policy] of [['default-policy/K=always', -1, null], ['default-policy/K=2', 2, null], ['default-policy/K=4', 4, null],
        ['maxRecompose=0/K=always', -1, { maxRecomposeAttempts: 0 }], ['maxRecompose=1,backoff0/K=1', 1, { maxRecomposeAttempts: 1, recomposeBackoffMs: 0, recomposeJitterMs: 0 }]])
      for (let r = 1; r <= Math.min(REPS, 5); r++) {
        const w = freshWorktree(initWorktreeGit, 'F5'); const t = Date.now();
        const A = spawnChild(atm, 'A', w.wt, w.bar, { injectK, policy, tmp: w.tmp }); const a = await A.done;
        const final = fs.readFileSync(join(w.wt, TARGET), 'utf8'); const injectedPresent = (final.match(/injected competing line/g) || []).length;
        record('F5-retry-exhaustion', variant, pin, r, { A: brief(a.j), wall_ms: Date.now() - t, injected_lines_present: injectedPresent, state: finalState(w.wt, a.j), err: a.j ? null : a.err });
        fs.rmSync(w.base, { recursive: true, force: true });
      }
  }
  // summary
  const groups = {};
  for (const x of results) {
    const k = `${x.scenario} | ${x.variant} | ${x.pin}`; const g = groups[k] ||= { n: 0, lost_effects: 0, runs_with_lost: 0, frame_bad: 0, leftovers: 0, outcomes: {} };
    g.n++; g.lost_effects += x.state.lost_effects.length; g.runs_with_lost += x.state.lost_effects.length ? 1 : 0; g.frame_bad += x.state.frame_ok ? 0 : 1; g.leftovers += x.state.leftover_files.length;
    const o = ['A', 'B'].filter((k2) => x[k2]).map((k2) => `${k2}:${x[k2].verdict}${x[k2].verdict !== 'applied' ? '(' + (x[k2].reason.match(/^[a-z-]+( attempts exhausted after \d+ of \d+)?/)?.[0] || x[k2].reason.slice(0, 30)) + ')' : ''}`).join(' ');
    g.outcomes[o] = (g.outcomes[o] || 0) + 1;
  }
  fs.writeFileSync(join(out, 'fault_results.json'), JSON.stringify({ test: 'r4-fault-scenarios-v1', node: process.version, pins, reps: REPS, summary: groups, runs: results }, null, 1));
  console.log(JSON.stringify(groups, null, 1));
}

if (arg('--child')) await child(); else await main();
