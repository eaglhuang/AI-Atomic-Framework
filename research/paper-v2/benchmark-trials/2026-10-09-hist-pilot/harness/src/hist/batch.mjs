#!/usr/bin/env node
// HIST batch: node src/hist/batch.mjs --pairs pairs.jsonl --out DIR --seeds 0[,1] [--arms a,b] [--plants] [--concurrency 3]
import { parseArgs } from 'node:util';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOne, HIST_ARMS, PLANTS, DEFAULT_PARAMS } from './run-pair.mjs';
const { values: o } = parseArgs({ options: { pairs: { type: 'string' }, out: { type: 'string' }, seeds: { type: 'string', default: '0' },
  arms: { type: 'string' }, plants: { type: 'boolean', default: false }, concurrency: { type: 'string', default: '3' }, resume: { type: 'boolean', default: false } } });
const pairs = readFileSync(o.pairs, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const arms = o.arms ? o.arms.split(',') : HIST_ARMS; const seeds = o.seeds.split(',').map(Number);
mkdirSync(o.out, { recursive: true });
const jobs = [];
for (const p of pairs) for (const k of seeds) for (const a of arms) jobs.push({ pair: p, arm: a, seedK: k, plant: null });
if (o.plants) for (const p of pairs) for (const pl of PLANTS) jobs.push({ pair: p, arm: pl === 'planted_raw_overwrite' ? 'planted_raw_overwrite' : 'steward', seedK: 0, plant: pl });
writeFileSync(join(o.out, 'batch_meta.json'), JSON.stringify({ started_at: new Date().toISOString(), node: process.version, atm_monorepo: process.env.ATM_MONOREPO, params: DEFAULT_PARAMS, n_jobs: jobs.length, arms, seeds, plants: o.plants }, null, 1));
let i = 0, done = 0;
async function lane() {
  while (i < jobs.length) {
    const j = jobs[i++]; const id = `${j.pair.pair_id.replace(':', '_')}__${j.plant ?? j.arm}__s${j.seedK}`;
    const dir = join(o.out, 'runs', id);
    if (o.resume && existsSync(join(dir, 'result.json'))) { done++; continue; }
    let r; try { r = await runOne({ pair: j.pair, arm: j.arm, seedK: j.seedK, outDir: dir, plant: j.plant }); }
    catch (e) { r = { pair_id: j.pair.pair_id, arm: j.arm, plant: j.plant, seed_k: j.seedK, harness_error: String(e.stack || e) }; mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'result.json'), JSON.stringify(r, null, 1)); }
    done++;
    const s = r.summary ?? {};
    const line = { id, pair_id: r.pair_id, stratum: r.stratum, arm: r.arm, plant: r.plant, seed_k: r.seed_k, n: s.n_intents, completed: s.completed, lost: s.lost_effects, blocked: s.blocked,
      corrupted: s.corrupted_files, structure: s.structure_violations, extra: s.extra_files, failed: s.run_failed, identity_ok: s.identity_ok, wall_ms: r.wall_ms, err: r.harness_error ? 'harness_error' : null };
    appendFileSync(join(o.out, 'index.jsonl'), JSON.stringify(line) + '\n');
    console.log(`[${done}/${jobs.length}] ${id} n=${s.n_intents} done=${s.completed} lost=${s.lost_effects} blk=${s.blocked} corrupt=${s.corrupted_files} failed=${s.run_failed}${r.harness_error ? ' HARNESS_ERROR' : ''}`);
  }
}
await Promise.all(Array.from({ length: Number(o.concurrency) }, lane));
writeFileSync(join(o.out, 'batch_done.json'), JSON.stringify({ finished_at: new Date().toISOString(), n: done }, null, 1));
process.exit(0);
