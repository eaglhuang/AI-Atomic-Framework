#!/usr/bin/env node
// A/B runner: "agent arm" vs "baseline arm" on the same task bank, fully scripted.
//
//   node run_ab.mjs pin      --protocol protocol.json            # print sha256 pins to paste into protocol.json
//   node run_ab.mjs run      --protocol protocol.json --out DIR  # run every (task, arm, seed); resumable
//   node run_ab.mjs report   --out DIR                           # aggregate + pre-registered decision
//
// Each run: fresh temp repo from seedDir -> each writer works in its own git worktree from the same
// base commit (order shuffled by seed) -> integration (git merge, or the arm's integrateCmd) ->
// hidden oracle copied in only after integration. No human or LLM judge is involved.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.GIT_AUTHOR_NAME ??= 'ab-runner';
process.env.GIT_AUTHOR_EMAIL ??= 'ab-runner@example.invalid';
process.env.GIT_COMMITTER_NAME ??= 'ab-runner';
process.env.GIT_COMMITTER_EMAIL ??= 'ab-runner@example.invalid';

const [cmd, ...rest] = process.argv.slice(2);
const opt = parseArgs(rest);

function parseArgs(list) {
  const o = {};
  for (let i = 0; i < list.length; i += 2) o[list[i].replace(/^--/, '')] = list[i + 1];
  return o;
}

function sha256Dir(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else {
        h.update(path.relative(dir, p) + '\0');
        h.update(fs.readFileSync(p));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

// The oracle may live outside the repo (AB_HIDDEN_DIR). Only its hash is committed in protocol.json.
function hiddenDirOf(bank, bankDir) {
  return process.env.AB_HIDDEN_DIR ? path.resolve(process.env.AB_HIDDEN_DIR) : path.resolve(bankDir, bank.hiddenDir);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(cwd, ...a) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function must(cwd, ...a) {
  const r = git(cwd, ...a);
  if (r.code !== 0) throw new Error(`git ${a.join(' ')} failed in ${cwd}: ${r.out}`);
  return r.out;
}

function rng(seedText) {
  let s = parseInt(crypto.createHash('sha256').update(seedText).digest('hex').slice(0, 8), 16) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadProtocol() {
  const file = path.resolve(opt.protocol || path.join(HERE, 'protocol.json'));
  const protocolDir = path.dirname(file);
  process.env.AB_PROTOCOL_DIR = HERE; // where agents/, arms/ and selftest/ live
  const protocol = JSON.parse(fs.readFileSync(file, 'utf8'));
  const taskFile = path.resolve(protocolDir, protocol.tasks);
  const bank = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  const bankDir = path.dirname(taskFile);
  return { protocol, protocolDir, bank, bankDir };
}

function cmdPin() {
  const { protocol, bank, bankDir, protocolDir } = loadProtocol();
  console.log(JSON.stringify({
    tasksSha256: sha256File(path.resolve(protocolDir, protocol.tasks)),
    seedSha256: sha256Dir(path.resolve(bankDir, bank.seedDir)),
    hiddenSha256: sha256Dir(hiddenDirOf(bank, bankDir)),
  }, null, 2));
}

function verifyPins(protocol, bank, bankDir, protocolDir) {
  const pins = protocol.pins || {};
  const actual = {
    tasksSha256: sha256File(path.resolve(protocolDir, protocol.tasks)),
    seedSha256: sha256Dir(path.resolve(bankDir, bank.seedDir)),
    hiddenSha256: sha256Dir(hiddenDirOf(bank, bankDir)),
  };
  for (const k of Object.keys(actual)) {
    if (pins[k] !== actual[k]) {
      throw new Error(`pre-registration pin mismatch for ${k}: protocol=${pins[k]} actual=${actual[k]}`);
    }
  }
}

function runAgent(arm, cwd, promptFile, usageFile, timeoutSec) {
  const command = arm.agentCmd
    .replaceAll('{prompt}', JSON.stringify(promptFile))
    .replaceAll('{usage}', JSON.stringify(usageFile));
  const t0 = Date.now();
  const r = spawnSync(command, {
    cwd, shell: true, encoding: 'utf8', timeout: timeoutSec * 1000,
    env: { ...process.env, AB_ARM: arm.name, AB_PROMPT_PREFIX: arm.promptPrefix || '' },
  });
  let usage = null;
  try { usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch { /* agent wrote no usage: stays null */ }
  return {
    exit: r.error?.code === 'ETIMEDOUT' ? 'timeout' : (r.status ?? -1),
    durationSec: (Date.now() - t0) / 1000,
    usage,
  };
}

function runOne({ protocol, bank, bankDir, task, arm, seed, workRoot }) {
  const runId = `${task.id}__${arm.name}__s${seed}`;
  const base = path.join(workRoot, runId);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.cpSync(path.resolve(bankDir, bank.seedDir), repo, { recursive: true });
  must(repo, 'init', '-q', '-b', 'main');
  must(repo, 'add', '-A');
  must(repo, 'commit', '-q', '-m', 'base');
  const baseCommit = must(repo, 'rev-parse', 'HEAD').trim();

  const rand = rng(`${task.id}|${arm.name}|${seed}`);
  const order = shuffle(task.writers, rand);

  const writers = [];
  for (const w of order) {
    const wt = path.join(base, `wt-${w.id}`);
    must(repo, 'worktree', 'add', '-q', '-b', `w-${w.id}`, wt, baseCommit);
    const promptFile = path.join(base, `prompt-${w.id}.json`);
    const usageFile = path.join(base, `usage-${w.id}.json`);
    fs.writeFileSync(promptFile, JSON.stringify(w.prompt));
    const res = runAgent(arm, wt, promptFile, usageFile, protocol.timeoutSec || 600);
    // The harness, not the agent, records the writer's output as a commit (so every arm is merged the same way).
    if (must(wt, 'status', '--porcelain').trim()) {
      must(wt, 'add', '-A');
      must(wt, 'commit', '-q', '-m', `writer ${w.id}`);
    }
    writers.push({ id: w.id, branch: `w-${w.id}`, worktree: wt, ...res });
  }

  // Integration into main. Baseline = plain git merge; an arm may replace it with integrateCmd.
  const integ = path.join(base, 'integration');
  must(repo, 'worktree', 'add', '-q', '--detach', integ, baseCommit);
  let conflicts = 0;
  const lost = [];
  let integrateReport = null;
  if (arm.integrateCmd) {
    const reportFile = path.join(base, 'integrate-report.json');
    const list = writers.map((w) => ({ id: w.id, branch: w.branch, worktree: w.worktree }));
    const r = spawnSync(arm.integrateCmd.replaceAll('{report}', JSON.stringify(reportFile)), {
      cwd: integ, shell: true, encoding: 'utf8', timeout: (protocol.timeoutSec || 600) * 1000,
      env: { ...process.env, AB_ARM: arm.name, AB_WRITERS: JSON.stringify(list), AB_REPO: repo },
    });
    try { integrateReport = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch { integrateReport = null; }
    conflicts = integrateReport?.conflicts ?? 0;
    lost.push(...(integrateReport?.lost ?? []));
    if (r.status !== 0 && !integrateReport) lost.push('integrate-failed');
  } else {
    for (const w of writers) {
      if (w.exit !== 0) { lost.push(w.id); continue; }
      const m = git(integ, 'merge', '--no-edit', '-q', w.branch);
      if (m.code !== 0) {
        conflicts++;
        lost.push(w.id);
        git(integ, 'merge', '--abort');
      }
    }
  }

  // Hidden oracle: copied in only now, after every agent has finished.
  const hiddenInto = path.join(integ, '__ab_hidden__');
  fs.cpSync(hiddenDirOf(bank, bankDir), hiddenInto, { recursive: true });
  const features = task.features.join(' ');
  const check = spawnSync(bank.checkCmd.replace('{features}', features), {
    cwd: hiddenInto, shell: true, encoding: 'utf8', timeout: 120000,
  });
  let featurePass = {};
  try { featurePass = JSON.parse(check.stdout.trim().split('\n').pop()); } catch { featurePass = {}; }
  const mainGreen = check.status === 0;

  const agentFailures = writers.filter((w) => w.exit !== 0).length;
  const row = {
    task: task.id, arm: arm.name, seed,
    order: order.map((w) => w.id),
    writers: writers.map(({ worktree, ...w }) => w),
    conflicts, lost, mainGreen, featurePass,
    interventions: conflicts + agentFailures,
    wallSec: writers.reduce((s, w) => s + w.durationSec, 0),
    tokens: sumTokens(writers),
    costUsd: sumCost(writers),
    integrateReport,
  };
  // Keep the run directory for forensics; the runner never deletes evidence.
  return row;
}

function sumTokens(writers) {
  if (writers.some((w) => !w.usage)) return null;
  return writers.reduce((s, w) => s + (w.usage.inputTokens || 0) + (w.usage.outputTokens || 0), 0);
}

function sumCost(writers) {
  if (writers.some((w) => !w.usage)) return null;
  return writers.reduce((s, w) => s + (w.usage.costUsd || 0), 0);
}

function rows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function cmdRun() {
  const { protocol, bank, bankDir, protocolDir } = loadProtocol();
  verifyPins(protocol, bank, bankDir, protocolDir);
  const out = path.resolve(opt.out || 'ab-out');
  fs.mkdirSync(out, { recursive: true });
  const rowsFile = path.join(out, 'runs.jsonl');
  const done = new Set();
  if (fs.existsSync(rowsFile)) {
    for (const line of fs.readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      done.add(`${r.task}|${r.arm}|${r.seed}`);
    }
  }
  const workRoot = path.join(out, 'work');
  fs.mkdirSync(workRoot, { recursive: true });
  const arms = Object.entries(protocol.arms).map(([name, a]) => ({ name, ...a }));
  for (const arm of arms) {
    if (arm.status === 'unverified' && !process.env.AB_ALLOW_UNVERIFIED) {
      throw new Error(`arm "${arm.name}" is unverified (${arm.note || 'no note'}); run its preflight first or set AB_ALLOW_UNVERIFIED=1`);
    }
  }
  const budget = process.env.AB_BUDGET_USD ? Number(process.env.AB_BUDGET_USD) : null;
  if (budget === null) throw new Error('set AB_BUDGET_USD (hard cap on API spend) before a run');
  let spent = 0;
  for (const r of rows(rowsFile)) spent += r.costUsd || 0;
  for (const task of bank.tasks) {
    for (const arm of arms) {
      for (const seed of protocol.seeds) {
        if (done.has(`${task.id}|${arm.name}|${seed}`)) continue;
        // Budget is checked between runs, so overshoot is at most one run's cost.
        if (spent >= budget) {
          console.log(`budget reached: spent $${spent.toFixed(4)} >= cap $${budget}; stopping (resumable)`);
          return;
        }
        const row = runOne({ protocol, bank, bankDir, task, arm, seed, workRoot });
        fs.appendFileSync(rowsFile, JSON.stringify(row) + '\n');
        spent += row.costUsd || 0;
        console.log(`${row.task} ${row.arm} s${seed} green=${row.mainGreen} conflicts=${row.conflicts}`);
      }
    }
  }
  console.log(`done -> ${rowsFile}`);
}

// Bootstrap CI over paired units (task, seed) for arm minus baseline.
function bootstrapDiff(pairs, iters, rand) {
  const n = pairs.length;
  const diffs = [];
  for (let b = 0; b < iters; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += pairs[Math.floor(rand() * n)];
    diffs.push(s / n);
  }
  diffs.sort((a, b) => a - b);
  return [diffs[Math.floor(0.025 * iters)], diffs[Math.floor(0.975 * iters)]];
}

// costUsdPerGreen(arm) / costUsdPerGreen(baseline); null when either side has no cost data or no green run.
function costRatio(armRows, baseRows) {
  const perGreen = (rs) => {
    if (rs.some((r) => r.costUsd === null)) return null;
    const green = rs.filter((r) => r.mainGreen).length;
    if (!green) return null;
    return rs.reduce((a, r) => a + r.costUsd, 0) / green;
  };
  const a = perGreen(armRows);
  const b = perGreen(baseRows);
  return a === null || b === null || b === 0 ? null : a / b;
}

function cmdReport() {
  const { protocol } = loadProtocol();
  const out = path.resolve(opt.out || 'ab-out');
  const rows = fs.readFileSync(path.join(out, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byArm = {};
  for (const r of rows) (byArm[r.arm] ||= []).push(r);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const summary = {};
  for (const [arm, rs] of Object.entries(byArm)) {
    const green = rs.filter((r) => r.mainGreen);
    const costs = rs.map((r) => r.costUsd).filter((x) => x !== null);
    summary[arm] = {
      runs: rs.length,
      mainGreenRate: mean(rs.map((r) => (r.mainGreen ? 1 : 0))),
      conflictsPerRun: mean(rs.map((r) => r.conflicts)),
      interventionsPerRun: mean(rs.map((r) => r.interventions)),
      wallSecPerRun: mean(rs.map((r) => r.wallSec)),
      tokensPerRun: mean(rs.map((r) => r.tokens).filter((x) => x !== null)),
      costUsdPerRun: costs.length ? mean(costs) : null,
      costUsdPerGreen: costs.length && green.length ? costs.reduce((a, b) => a + b, 0) / green.length : null,
      tokenNullRuns: rs.filter((r) => r.tokens === null).length,
    };
  }
  const base = protocol.baselineArm;
  const decision = { primary: 'mainGreenRate', baselineArm: base, comparisons: {} };
  const rand = rng('bootstrap|' + protocol.id);
  for (const arm of Object.keys(byArm)) {
    if (arm === base || !byArm[base]) continue;
    const key = (r) => `${r.task}|${r.seed}`;
    const b = new Map(byArm[base].map((r) => [key(r), r]));
    const pairs = [];
    for (const r of byArm[arm]) {
      const o = b.get(key(r));
      if (o) pairs.push((r.mainGreen ? 1 : 0) - (o.mainGreen ? 1 : 0));
    }
    if (!pairs.length) continue;
    const diff = mean(pairs);
    const [lo, hi] = bootstrapDiff(pairs, 10000, rand);
    const th = protocol.thresholds;
    let verdict = 'inconclusive';
    const cost = costRatio(byArm[arm], byArm[base]);
    if (diff * 100 >= th.minDiffPP && lo > 0) {
      // Pre-registered cost gate: a quality win only counts if cost per green stays within costRatioMax.
      if (cost === null) verdict = 'inconclusive (cost unavailable)';
      else if (cost <= th.costRatioMax) verdict = `${arm} supported`;
      else verdict = `${arm} quality-supported, cost gate failed (ratio ${cost.toFixed(2)} > ${th.costRatioMax})`;
    }
    else if (diff * 100 <= -th.minDiffPP && hi < 0) verdict = `${arm} refuted (worse)`;
    else if (Math.abs(diff * 100) < th.minDiffPP && lo <= 0 && hi >= 0) verdict = 'no difference';
    decision.comparisons[arm] = { pairedUnits: pairs.length, diffPP: +(diff * 100).toFixed(2), ci95PP: [+(lo * 100).toFixed(2), +(hi * 100).toFixed(2)], costPerGreenRatio: cost === null ? null : +cost.toFixed(3), verdict };
  }
  const report = { protocol: protocol.id, summary, decision, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (cmd === 'pin') cmdPin();
else if (cmd === 'run') cmdRun();
else if (cmd === 'report') cmdReport();
else {
  console.error('usage: node run_ab.mjs <pin|run|report> [--protocol FILE] [--out DIR]');
  process.exit(2);
}
