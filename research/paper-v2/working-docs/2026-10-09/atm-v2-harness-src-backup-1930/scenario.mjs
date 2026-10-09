// Scenario generator — pure function (fixture manifest, seed, params) -> scenarios.
// No wall-clock, no Math.random: everything derives from the seeded PRNG.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_PARAMS = Object.freeze({
  n_agents: 4,
  hot_ratio: 0.4,
  overlap: 'med',            // low | med | high
  cold_policy: 'queue',      // block | queue (atm mode only)
  composer_enabled: true,
  trial_count: 40,
  tick_interval_ms: 50,
  hold_ms_min: 20,
  hold_ms_max: 60,
  jitter_ms: 15,
  idle_prob: 0.1,
  queue_timeout_ms: 2000,
  max_provisional_depth: 1,
  cold_atom_identity: 'intent', // real backend: intent | region
  cold_retry: 'once',           // real backend: once | loop
});

// Params that must match when a second agent joins an existing run.
export const CORE_PARAM_KEYS = ['n_agents', 'hot_ratio', 'overlap', 'cold_policy', 'composer_enabled', 'trial_count'];

const OVERLAP_P = { low: 0.25, med: 0.5, high: 0.8, 'cold-same-file': 1, 'cold-one-file': 1 };
// Cold-contention modes (all intents of a trial hit ONE cold file, region 'body'):
//   cold-same-file: the shared cold file is drawn per trial from the cold pool (hot_ratio ignored for the contended file)
//   cold-one-file : every trial uses the first cold file in the manifest (maximum same-file pressure)
export const COLD_OVERLAP_MODES = ['cold-same-file', 'cold-one-file'];
export const VENDORS = ['cursor', 'claude', 'codex', 'cursor', 'claude', 'codex', 'other', 'other'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadManifest(fixtureDir) {
  return JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
}

export function agentForSlot(slot) {
  const vendor = VENDORS[slot % VENDORS.length];
  return { slot, vendor, agent_id: `${vendor}:mock-s${slot}` };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pad = (n, w = 3) => String(n).padStart(w, '0');

export function generateScenarios(manifest, seed, params) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const rng = mulberry32(seed);
  const hot = manifest.files.filter((f) => f.temperature === 'hot');
  const cold = manifest.files.filter((f) => f.temperature === 'cold');
  const pOverlap = OVERLAP_P[p.overlap] ?? OVERLAP_P.med;
  const scenarios = [];

  for (let t = 0; t < p.trial_count; t++) {
    const trial_id = `t${pad(t)}`;
    const scenario_id = `s${seed}-${trial_id}`;
    // which slots participate in this trial (at least 2)
    let slots = [];
    for (let s = 0; s < p.n_agents; s++) if (rng() >= p.idle_prob) slots.push(s);
    while (slots.length < Math.min(2, p.n_agents)) {
      const s = Math.floor(rng() * p.n_agents);
      if (!slots.includes(s)) slots.push(s);
    }
    slots.sort((a, b) => a - b);

    const coldMode = COLD_OVERLAP_MODES.includes(p.overlap);
    let contended = rng() < p.hot_ratio ? pick(rng, hot) : pick(rng, cold);
    if (p.overlap === 'cold-same-file' && contended.temperature !== 'cold') contended = pick(rng, cold);
    if (p.overlap === 'cold-one-file') contended = cold[0];
    const usedPrivate = new Set([contended.path]);
    const intents = slots.map((slot, k) => {
      let file;
      if (coldMode || rng() < pOverlap) {
        file = contended;
      } else {
        const pool = rng() < p.hot_ratio ? hot : cold;
        let tries = 0;
        do { file = pick(rng, pool); tries++; } while (usedPrivate.has(file.path) && tries < 20);
        usedPrivate.add(file.path);
      }
      const region = pick(rng, file.regions);
      const hold_ms = Math.round(p.hold_ms_min + rng() * (p.hold_ms_max - p.hold_ms_min));
      const jitter_ms = Math.round(rng() * p.jitter_ms);
      return {
        intent_id: `${scenario_id}-i${k}`,
        trial_id,
        trial_index: t,
        agent_slot: slot,
        paths: [file.path],
        path: file.path,
        region,
        rw_set: { read: [`${file.path}#${region}`], write: [`${file.path}#${region}`] },
        hot_or_cold_hint: file.temperature,
        hold_ms,
        jitter_ms,
        payload_template: `Edit region <${region}> of ${file.path}: append one line describing change ${scenario_id}-i${k}.`,
      };
    });

    // ground-truth labels, assigned before any execution
    for (const it of intents) {
      const group = intents.filter((o) => o.path === it.path);
      if (group.length === 1) {
        it.expected_class = 'no_conflict';
        it.expected_class_control = 'no_conflict';
        continue;
      }
      it.expected_class_control = 'control_racy_write';
      if (it.hot_or_cold_hint === 'cold') {
        it.expected_class = p.cold_policy === 'block' ? 'cold_block' : 'cold_queue';
      } else {
        const sameRegion = group.filter((o) => o.region === it.region).length;
        it.expected_class = sameRegion > 1 || !p.composer_enabled ? 'hot_provisional' : 'composer_cowrite';
      }
    }
    scenarios.push({
      scenario_id,
      seed,
      fixture_id: manifest.fixture_id,
      trial_id,
      intents,
      labels: Object.fromEntries(intents.map((i) => [i.intent_id, i.expected_class])),
      oracle: { type: 'marker_present', marker: 'atm-edit <intent_id>' },
    });
  }
  return scenarios;
}

export function scenarioHash(scenarios) {
  return createHash('sha256').update(JSON.stringify(scenarios)).digest('hex');
}
