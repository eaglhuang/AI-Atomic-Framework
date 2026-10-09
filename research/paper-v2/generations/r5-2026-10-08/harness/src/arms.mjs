import { performance } from 'node:perf_hooks';
// Arm catalog (D5 freeze): steward is the ONLY RQ2 main_method.
// D1–D4 = correctness foils/ablations; C4 = diagnostics (not competitors).

export const ARM_IDS = Object.freeze([
  'steward', 'file_lock', 'occ', 'git_three_way', 'bare_composer', 'ideal_sync', 'admission_only', 'raw_overwrite',
]);

/** Canonical arm descriptors (frozen for paper/table footnotes). */
export const ARM_DEFS = Object.freeze({
  steward: {
    arm: 'steward',
    mode: 'atm',
    atm_writer: 'steward',
    arm_role: 'main_method',
    rq: 'RQ2',
    diagnostic: false,
    correctness_competitor: true,
    label: 'MAIN — ATM composer + neutral steward apply (RQ2)',
    note: 'D5 freeze: ONLY RQ2 main correctness method. Full ATM admit + ComposeWindowManager + composeBrokerProposals + applyStewardPlan.',
  },
  file_lock: {
    arm: 'file_lock',
    mode: 'atm',
    atm_writer: 'file_lock',
    arm_role: 'baseline_serial',
    rq: 'RQ2-baseline',
    diagnostic: false,
    correctness_competitor: true, // foil that claims correctness via serialization
    label: 'BASELINE serial — per-file async mutex + RMW (no composer)',
    note: 'D1 foil: ATM admit, then one writer per file (lock covers hold+apply). Conservative correct cost; NOT the main RQ2 method.',
  },
  occ: {
    arm: 'occ',
    mode: 'atm',
    atm_writer: 'occ',
    arm_role: 'baseline_occ',
    rq: 'RQ2-baseline',
    diagnostic: false,
    correctness_competitor: true,
    label: 'BASELINE OCC — optimistic CAS + bounded retry/rebuild (no composer)',
    note: 'D2 foil: hold without file lock; on version drift rebuild marker insert on current bytes and retry (max occ_max_retries). NOT the main RQ2 method.',
  },
  git_three_way: {
    arm: 'git_three_way',
    mode: 'atm',
    atm_writer: 'git_three_way',
    arm_role: 'baseline_git',
    rq: 'RQ2-baseline',
    diagnostic: false,
    correctness_competitor: true,
    label: 'BASELINE git — pairwise git merge-file fold (n-way disclosed as fold)',
    note: 'D3 foil: shared-base patches left-folded via git merge-file; conflict → blocked. NOT true multi-parent n-way; NOT the main RQ2 method.',
  },
  bare_composer: {
    arm: 'bare_composer',
    mode: 'atm',
    atm_writer: 'bare_composer',
    arm_role: 'baseline_bare_composer',
    rq: 'RQ2-ablation',
    diagnostic: false,
    correctness_competitor: true,
    label: 'BASELINE bare composer — compose+steward apply, admission bypassed',
    note: 'D4 ablation: same ComposeWindowManager + composeBrokerProposals + applyStewardPlan as steward; BareAdmitBroker always composer_merge (no RealATM admit/leases). Isolates composition vs routing governance.',
  },
  ideal_sync: {
    arm: 'ideal_sync',
    mode: 'atm',
    atm_writer: 'sync',
    arm_role: 'upper_bound',
    rq: 'diagnostic',
    diagnostic: true,
    correctness_competitor: false,
    label: 'DIAGNOSTIC upper_bound — ideal in-process RMW (atm_writer=sync)',
    note: 'C4 upper-bound reference if composer/rebase were free; NOT a correctness competitor.',
  },
  admission_only: {
    arm: 'admission_only',
    mode: 'atm',
    atm_writer: 'stale',
    arm_role: 'motivation',
    rq: 'diagnostic',
    diagnostic: true,
    correctness_competitor: false,
    label: 'DIAGNOSTIC motivation — ATM admit without composer apply (atm_writer=stale)',
    note: 'C4 motivation arm showing lost-update without steward apply; NOT a correctness competitor.',
  },
  raw_overwrite: {
    arm: 'raw_overwrite',
    mode: 'control',
    atm_writer: null,
    arm_role: 'baseline_raw',
    rq: 'diagnostic',
    diagnostic: true,
    correctness_competitor: false,
    label: 'DIAGNOSTIC baseline_raw — ControlWriter racy overwrite (no ATM)',
    note: 'C4 raw concurrent overwrite baseline; NOT a correctness competitor.',
  },
});

/** CLI synonyms → canonical arm id. */
const ALIASES = Object.freeze({
  steward: 'steward',
  main: 'steward',
  file_lock: 'file_lock',
  'file-lock': 'file_lock',
  per_file_lock: 'file_lock',
  'per-file-lock': 'file_lock',
  serial: 'file_lock',
  occ: 'occ',
  cas_retry: 'occ',
  optimistic: 'occ',
  'cas-retry': 'occ',
  git_three_way: 'git_three_way',
  'git-three-way': 'git_three_way',
  git_merge: 'git_three_way',
  'git-merge': 'git_three_way',
  three_way: 'git_three_way',
  'three-way': 'git_three_way',
  bare_composer: 'bare_composer',
  'bare-composer': 'bare_composer',
  composer_only: 'bare_composer',
  'composer-only': 'bare_composer',
  bare: 'bare_composer',
  ideal_sync: 'ideal_sync',
  sync: 'ideal_sync',
  'ideal-sync': 'ideal_sync',
  admission_only: 'admission_only',
  stale: 'admission_only',
  'admission-only': 'admission_only',
  raw_overwrite: 'raw_overwrite',
  control: 'raw_overwrite',
  raw: 'raw_overwrite',
  'raw-overwrite': 'raw_overwrite',
});

export function canonicalizeArmId(name) {
  if (name == null || name === '') return null;
  const raw = String(name).trim();
  const key = raw.toLowerCase().replace(/-/g, '_');
  const via = ALIASES[raw] ?? ALIASES[key] ?? ALIASES[raw.toLowerCase()];
  if (!via || !ARM_DEFS[via]) {
    throw new Error(
      `--arm must be one of ${ARM_IDS.join('|')} ` +
      `(aliases: per_file_lock→file_lock, sync→ideal_sync, stale→admission_only, control→raw_overwrite); got ${name}`,
    );
  }
  return via;
}

/** Resolve arm from explicit --arm, else infer from mode + atm_writer. */
export function resolveArm({ arm, mode, atm_writer } = {}) {
  if (arm) {
    const id = canonicalizeArmId(arm);
    return { ...ARM_DEFS[id] };
  }
  if (mode === 'control') return { ...ARM_DEFS.raw_overwrite };
  if (mode === 'atm') {
    if (atm_writer === 'steward') return { ...ARM_DEFS.steward };
    if (atm_writer === 'file_lock') return { ...ARM_DEFS.file_lock };
    if (atm_writer === 'occ') return { ...ARM_DEFS.occ };
    if (atm_writer === 'git_three_way') return { ...ARM_DEFS.git_three_way };
    if (atm_writer === 'bare_composer') return { ...ARM_DEFS.bare_composer };
    if (atm_writer === 'stale') return { ...ARM_DEFS.admission_only };
    return { ...ARM_DEFS.ideal_sync };
  }
  return null;
}

/** Fields stamped onto meta.json and every decision/oracle event. */
export function armEventFields(armDef) {
  if (!armDef) return {};
  return {
    arm: armDef.arm,
    arm_role: armDef.arm_role,
    rq: armDef.rq ?? null,
    diagnostic: armDef.diagnostic,
    correctness_competitor: armDef.correctness_competitor,
  };
}

/** Frozen RQ2 main-method invocation (D5). Pin ATM_MONOREPO to 5692474f… */
export const MAIN_METHOD_INVOCATION = Object.freeze({
  arm: 'steward',
  atm_backend: 'real',
  compose_window_ms: 100,
  atm_sha: '5692474f7db70ab52a7a71c8af4867609e7e4b43',
  one_liner:
    'export ATM_MONOREPO=/path/to/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43 && '
    + 'node src/cli.mjs start --arm steward --atm-backend real --compose-window-ms 100 '
    + '--seed 11 --agents 3 --trials 5 --hot-ratio 1 --overlap high --force',
});

export function armHelpText() {
  return `Arms (--arm): steward (RQ2 MAIN) | file_lock (D1) | occ (D2) | git_three_way (D3) | bare_composer (D4) | ideal_sync | admission_only | raw_overwrite
  ONLY main_method / RQ2: --arm steward (aliases: main). All other arms are baselines or diagnostics.
  Mapping: steward→atm+steward; bare_composer→atm+bare_composer; file_lock→atm+file_lock; occ→atm+occ;
  git_three_way→atm+git_three_way; ideal_sync→atm+sync; admission_only→atm+stale; raw_overwrite→control.
  Frozen main invoke: --arm steward --atm-backend real --compose-window-ms 100 (ATM pin 5692474f…).
  See runs/baselines/D5_SUMMARY.md.`;
}

/**
 * In-process async mutex table keyed by file path (D1).
 * One exclusive critical section per path; different files run in parallel.
 */
export class FileLockTable {
  constructor() {
    this._tails = new Map(); // path → Promise chain tail
  }

  /** Run fn exclusively for `path`. Returns { result, lock_wait_ms }. */
  async runExclusive(path, fn) {
    const key = String(path);
    let release;
    const gate = new Promise((r) => { release = r; });
    const prev = this._tails.get(key) ?? Promise.resolve();
    this._tails.set(key, prev.then(() => gate, () => gate));
    const t0 = performance.now();
    await prev;
    const lock_wait_ms = performance.now() - t0;
    try {
      const result = await fn();
      return { result, lock_wait_ms };
    } finally {
      release();
    }
  }
}
