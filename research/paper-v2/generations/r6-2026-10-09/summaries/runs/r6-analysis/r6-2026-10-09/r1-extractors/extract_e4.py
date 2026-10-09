#!/usr/bin/env python3
"""E4 MP extractor — receipt reconcile, zombie leases, write monitor; DRAFT."""
from __future__ import annotations
import json, math, re, statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path('/workspace/reports/atm-v2-harness')
RUNS = ROOT / "runs"
OUT = Path('/workspace/reports/atm-v2-harness/runs/r6-analysis/r6-2026-10-09/r1-extractors')
SEEDS = [11, 17, 23]
PROCS = [2, 4, 8]

def mean(a):
    return statistics.mean(a) if a else None
def pstdev(a):
    return statistics.pstdev(a) if len(a) > 1 else (0.0 if a else None)
def r(x, d=2):
    return None if x is None else round(x, d)
def pct(arr, q):
    if not arr: return None
    s = sorted(arr)
    idx = min(len(s)-1, max(0, math.ceil(q*len(s))-1))
    return round(s[idx], 2)

def load_cell(run_id: str, kind: str):
    d = RUNS / run_id
    if not (d / "meta.json").exists():
        return None
    meta = json.loads((d / "meta.json").read_text())
    mode = "atm" if meta.get("modes", {}).get("atm") else "control"
    mm = meta["modes"][mode]
    mp = mm.get("mp") or {}
    wall_ms = mm.get("wall_clock_ms") or 0
    orc_p = d / mode / "artifacts" / "oracle_summary.json"
    orc = json.loads(orc_p.read_text())["summary"] if orc_p.exists() else {}

    ev_dir = d / mode / "events"
    decs, submits = [], []
    pdw_sum = 0
    pdw_seen = False
    for f in ev_dir.glob("*.jsonl"):
        if f.name == "compose_batches.jsonl":
            continue
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            o = json.loads(line)
            if o.get("event") == "decision":
                decs.append(o)
                if "proposer_direct_writes" in o and o["proposer_direct_writes"] is not None:
                    pdw_seen = True
                    pdw_sum += int(o["proposer_direct_writes"] or 0)
            elif o.get("event") == "submit":
                submits.append(o)

    outcomes = Counter(e.get("outcome") for e in decs)
    offered = orc.get("n_effects") or 0
    eligible = orc.get("n_eligible") or offered
    correct = orc.get("correct") or 0
    lost = orc.get("lost") or 0
    wall_s = wall_ms / 1000.0 if wall_ms else 0
    goodput = correct / wall_s if wall_s > 0 else None

    # receipt reconciliation
    intents_expected = offered  # pre-registered effects == intents
    receipt_ok = (len(decs) == intents_expected)
    worker_errors = mp.get("worker_errors")
    worker_exit_ok = None
    if mp.get("worker_exit"):
        worker_exit_ok = all((x.get("code") in (0, None)) for x in mp["worker_exit"])
    residue = mp.get("registry_residue_active_intents")
    if residue is None:
        residue = mm.get("registry_active_end")

    # logical_id
    lid_ok = None
    exp = d / mode / "scenarios" / "expected_effects.json"
    if exp.exists():
        effs = json.loads(exp.read_text()).get("effects") or []
        if effs:
            lid_ok = all(e.get("logical_id") and e["logical_id"] != e.get("intent_id") for e in effs)

    admit = [e.get("admission_ms") or e.get("broker_ms") or 0 for e in decs]
    total = [e.get("total_ms") or 0 for e in decs]

    return {
        "run_id": run_id,
        "kind": kind,
        "arm_role": meta.get("arm_role") or kind,
        "arm": meta.get("arm") or meta.get("params", {}).get("arm"),
        "procs": meta.get("procs") or (1 if kind == "sp_baseline" else mp.get("procs")),
        "process_model": meta.get("process_model") or ("single-process" if kind == "sp_baseline" else "multi-process"),
        "scenario_seed": meta.get("scenario_seed") or meta.get("seed"),
        "scheduler_seed": meta.get("scheduler_seed"),
        "seed_pair_ok": (meta.get("scenario_seed") or meta.get("seed")) != meta.get("scheduler_seed"),
        "registry_sync": (mp.get("registry_sync") or meta.get("params", {}).get("mp_registry_sync")),
        "apply_lock": (mp.get("apply_lock") or meta.get("params", {}).get("mp_apply_lock")),
        "distinct_pids": mp.get("distinct_pids") if mp else 1,
        "offered": offered,
        "eligible": eligible,
        "correct": correct,
        "lost": lost,
        "blocked": outcomes.get("blocked", 0),
        "commits": outcomes.get("commit", 0),
        "errors": outcomes.get("error", 0),
        "rate_elig": r(correct / eligible, 4) if eligible else None,
        "goodput": r(goodput, 2),
        "wall_ms": r(wall_ms, 2),
        "admit_p50": pct(admit, 0.5),
        "admit_p95": pct(admit, 0.95),
        "total_p50": pct(total, 0.5),
        "total_p95": pct(total, 0.95),
        "cas_conflicts": mp.get("cas_conflicts"),
        "registry_txns": mp.get("registry_txns"),
        "registry_txns_retried": mp.get("registry_txns_retried"),
        "apply_lock_spins": mp.get("apply_lock_spins"),
        "zombie_leases": residue,
        "zombie_zero": residue == 0 if residue is not None else None,
        "n_decisions": len(decs),
        "n_submits": len(submits),
        "receipt_ok": receipt_ok,
        "worker_errors": worker_errors,
        "worker_exit_ok": worker_exit_ok,
        "proposer_direct_writes_sum": pdw_sum if pdw_seen else None,
        "proposer_direct_writes_ok": (pdw_sum == 0) if pdw_seen else None,
        "logical_id_decoupled": lid_ok,
        "overlap_same_region_xproc": (mp.get("overlapping_commit_holds") or {}).get("same_region_cross_process_pairs"),
    }

def main():
    cells = []
    missing = []
    plan = []
    for procs in PROCS:
        for seed in SEEDS:
            plan.append((f"e4-hot_conflict-steward-p{procs}-s{seed}", "main_steward_mp"))
    for seed in SEEDS:
        plan.append((f"e4-hot_conflict-steward-sp-s{seed}", "sp_baseline"))
    for seed in SEEDS:
        plan.append((f"e4-hot_conflict-fault_naive-p8-s{seed}", "fault_naive"))
    for seed in SEEDS:
        plan.append((f"e4-hot_conflict-fault_nolock-p8-s{seed}", "fault_nolock"))

    for rid, kind in plan:
        c = load_cell(rid, kind)
        if not c:
            missing.append(rid)
        else:
            cells.append(c)

    groups = defaultdict(list)
    for c in cells:
        key = (c["kind"], c["procs"], c["registry_sync"], c["apply_lock"])
        groups[key].append(c)

    agg = []
    for key, rows in sorted(groups.items(), key=lambda x: (x[0][0], x[0][1] or 0)):
        kind, procs, sync, alock = key
        def col(k):
            return [r[k] for r in rows if r.get(k) is not None]
        agg.append({
            "kind": kind,
            "procs": procs,
            "registry_sync": sync,
            "apply_lock": alock,
            "n": len(rows),
            "correct_mean": r(mean(col("correct"))),
            "lost_mean": r(mean(col("lost"))),
            "blocked_mean": r(mean(col("blocked"))),
            "errors_mean": r(mean(col("errors"))),
            "rate_elig_mean": r(mean(col("rate_elig")), 4),
            "goodput_mean": r(mean(col("goodput"))),
            "wall_mean": r(mean(col("wall_ms"))),
            "zombie_mean": r(mean(col("zombie_leases")), 2) if col("zombie_leases") else None,
            "zombie_zero_all": all(x.get("zombie_zero") for x in rows) if kind.startswith("main") or kind == "sp_baseline" else None,
            "receipt_ok_all": all(x.get("receipt_ok") for x in rows),
            "worker_exit_ok_all": all(x.get("worker_exit_ok") is not False for x in rows),
            "pdw_ok_all": all(x.get("proposer_direct_writes_ok") is not False for x in rows),
            "cas_conflicts_mean": r(mean(col("cas_conflicts"))),
            "admit_p50_mean": r(mean(col("admit_p50"))),
            "total_p50_mean": r(mean(col("total_p50"))),
            "distinct_pids_mean": r(mean(col("distinct_pids")), 1),
        })

    raw = {
        "schema": "atm-bench.e4_compare_raw.v1",
        "banner": "DRAFT evidence — not a win claim; fault arms isolated",
        "n_cells": len(cells),
        "n_missing": len(missing),
        "missing": missing,
        "seed_pair_ok": sum(1 for c in cells if c["seed_pair_ok"]),
        "logical_id_decoupled_ok": sum(1 for c in cells if c["logical_id_decoupled"]),
        "main_zombie_zero": all(c["zombie_zero"] for c in cells if c["kind"] == "main_steward_mp"),
        "main_receipt_ok": all(c["receipt_ok"] for c in cells if c["kind"] == "main_steward_mp"),
        "cells": cells,
        "aggregate": agg,
    }
    (OUT / "e4_compare_raw.json").write_text(json.dumps(raw, indent=2) + "\n")
    print(f"cells={len(cells)} missing={missing} main_zombie_zero={raw['main_zombie_zero']} main_receipt={raw['main_receipt_ok']}")
    for a in agg:
        print(a["kind"], "p"+str(a["procs"]), "sync="+str(a["registry_sync"]), "lock="+str(a["apply_lock"]),
              "correct", a["correct_mean"], "lost", a["lost_mean"], "zombie", a["zombie_mean"],
              "receipt", a["receipt_ok_all"], "rate", a["rate_elig_mean"])
    return raw

if __name__ == "__main__":
    main()
