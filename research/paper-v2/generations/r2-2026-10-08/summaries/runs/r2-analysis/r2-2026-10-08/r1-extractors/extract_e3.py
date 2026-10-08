#!/usr/bin/env python3
"""E3 window-sweep extractor — A2 metrics; DRAFT no win claims."""
from __future__ import annotations
import json, math, re, statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path('/workspace/reports/atm-v2-harness')
RUNS = ROOT / "runs"
OUT_DIR = Path('/workspace/reports/atm-v2-harness/runs/r2-analysis/r2-2026-10-08/r1-extractors')

WINDOWS = [0, 25, 50, 100, 200, 400]
SEEDS = [11, 17, 23, 29, 31]
WORKLOADS = ["cold", "hot_disjoint", "hot_conflict"]

def pct(arr, q):
    if not arr:
        return None
    s = sorted(arr)
    # nearest-rank (same spirit as arm-stats)
    idx = min(len(s) - 1, max(0, math.ceil(q * len(s)) - 1))
    return round(s[idx], 2)

def mean(a):
    return statistics.mean(a) if a else None

def pstdev(a):
    return statistics.pstdev(a) if len(a) > 1 else (0.0 if a else None)

def r(x, d=2):
    if x is None:
        return None
    return round(x, d)

def load_cell(run_id: str):
    d = RUNS / run_id
    meta_p = d / "meta.json"
    if not meta_p.exists():
        return None
    meta = json.loads(meta_p.read_text())
    mode = "atm" if meta.get("modes", {}).get("atm") else "control"
    mm = meta["modes"][mode]
    wall_ms = mm.get("wall_clock_ms") or mm.get("duration_ms") or 0
    orc_p = d / mode / "artifacts" / "oracle_summary.json"
    orc = json.loads(orc_p.read_text())["summary"] if orc_p.exists() else {}
    # decisions
    ev_dir = d / mode / "events"
    decs = []
    for f in ev_dir.glob("*.jsonl"):
        if f.name == "compose_batches.jsonl":
            continue
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            o = json.loads(line)
            if o.get("event") == "decision":
                decs.append(o)
    batches = []
    bp = ev_dir / "compose_batches.jsonl"
    if bp.exists():
        for line in bp.read_text().splitlines():
            if line.strip():
                batches.append(json.loads(line))

    offered = orc.get("n_effects") or 0
    eligible = orc.get("n_eligible") or offered
    correct = orc.get("correct") or 0
    lost = orc.get("lost") or 0
    blocked = sum(1 for e in decs if e.get("outcome") == "blocked")
    commits = sum(1 for e in decs if e.get("outcome") == "commit")
    admit = [e.get("admission_ms") or e.get("broker_ms") or 0 for e in decs]
    total = [e.get("total_ms") or 0 for e in decs]
    cas_sum = sum(e.get("cas_retry") or 0 for e in decs)
    repro_sum = sum(e.get("repropose_rounds") or 0 for e in decs)
    win_wait = [e.get("window_wait_ms") or 0 for e in decs]
    batch_sizes = []
    for b in batches:
        ids = b.get("intent_ids") or b.get("logical_ids") or []
        batch_sizes.append(len(ids))
    # also from decisions
    if not batch_sizes:
        batch_sizes = [e.get("compose_batch_size") or 1 for e in decs]

    wall_s = (wall_ms or 0) / 1000.0
    goodput = (correct / wall_s) if wall_s > 0 else None
    rate_elig = (correct / eligible) if eligible else None
    rate_off = (correct / offered) if offered else None
    elig_cov = (eligible / offered) if offered else None

    # logical_id check (post-gaps)
    lid_ok = None
    exp_p = d / mode / "scenarios" / "expected_effects.json"
    if exp_p.exists():
        effs = json.loads(exp_p.read_text()).get("effects") or []
        if effs:
            lid_ok = all(e.get("logical_id") and e["logical_id"] != e.get("intent_id") for e in effs)

    return {
        "run_id": run_id,
        "workload": None,  # filled by caller
        "arm": meta.get("params", {}).get("arm") or meta.get("params", {}).get("atm_writer"),
        "compose_window_ms": meta.get("params", {}).get("compose_window_ms"),
        "scenario_seed": meta.get("scenario_seed") or meta.get("seed"),
        "scheduler_seed": meta.get("scheduler_seed"),
        "scenario_hash": meta.get("scenario_hash"),
        "offered": offered,
        "eligible": eligible,
        "correct": correct,
        "lost": lost,
        "blocked": blocked,
        "commits": commits,
        "rate_elig": r(rate_elig, 4),
        "rate_off": r(rate_off, 4),
        "elig_cov": r(elig_cov, 4),
        "goodput": r(goodput, 2),
        "wall_ms": r(wall_ms, 2),
        "admit_p50": pct(admit, 0.5),
        "admit_p95": pct(admit, 0.95),
        "admit_p99": pct(admit, 0.99),
        "total_p50": pct(total, 0.5),
        "total_p95": pct(total, 0.95),
        "total_p99": pct(total, 0.99),
        "window_wait_p50": pct(win_wait, 0.5),
        "window_wait_p95": pct(win_wait, 0.95),
        "cas_retry_sum": cas_sum,
        "repropose_sum": repro_sum,
        "batch_size_mean": r(mean(batch_sizes), 3) if batch_sizes else None,
        "batch_size_max": max(batch_sizes) if batch_sizes else None,
        "n_batches": len(batches) if batches else len({e.get("batch_id") for e in decs if e.get("batch_id")}),
        "logical_id_decoupled": lid_ok,
        "seed_pair_ok": (meta.get("scenario_seed") or meta.get("seed")) != meta.get("scheduler_seed"),
    }

def parse_rid(rid: str):
    # e3-<wl>-<arm>-w<ms>-s<seed>
    m = re.match(r"^e3-(cold|hot_disjoint|hot_conflict)-(steward|bare_composer)-w(\d+)-s(\d+)$", rid)
    if not m:
        return None
    return {"workload": m.group(1), "arm": m.group(2), "window": int(m.group(3)), "seed": int(m.group(4))}

def main():
    cells = []
    missing = []
    for wl in WORKLOADS:
        for w in WINDOWS:
            for seed in SEEDS:
                rid = f"e3-{wl}-steward-w{w}-s{seed}"
                c = load_cell(rid)
                if not c:
                    missing.append(rid)
                    continue
                c["workload"] = wl
                cells.append(c)
    for w in WINDOWS:
        for seed in SEEDS:
            rid = f"e3-hot_conflict-bare_composer-w{w}-s{seed}"
            c = load_cell(rid)
            if not c:
                missing.append(rid)
                continue
            c["workload"] = "hot_conflict"
            cells.append(c)

    # aggregate by (workload, arm, window)
    groups = defaultdict(list)
    for c in cells:
        groups[(c["workload"], c["arm"], c["compose_window_ms"])].append(c)

    agg = []
    for (wl, arm, w), rows in sorted(groups.items(), key=lambda x: (x[0][0], x[0][1], x[0][2] if x[0][2] is not None else -1)):
        def col(k):
            return [r[k] for r in rows if r[k] is not None]
        agg.append({
            "workload": wl,
            "arm": arm,
            "compose_window_ms": w,
            "n_seeds": len(rows),
            "correct_mean": r(mean(col("correct"))),
            "correct_sd": r(pstdev(col("correct"))),
            "lost_mean": r(mean(col("lost"))),
            "blocked_mean": r(mean(col("blocked"))),
            "rate_elig_mean": r(mean(col("rate_elig")), 4),
            "rate_off_mean": r(mean(col("rate_off")), 4),
            "elig_cov_mean": r(mean(col("elig_cov")), 4),
            "goodput_mean": r(mean(col("goodput"))),
            "goodput_sd": r(pstdev(col("goodput"))),
            "wall_mean": r(mean(col("wall_ms"))),
            "wall_sd": r(pstdev(col("wall_ms"))),
            "admit_p50_mean": r(mean(col("admit_p50"))),
            "admit_p95_mean": r(mean(col("admit_p95"))),
            "admit_p99_mean": r(mean(col("admit_p99"))),
            "total_p50_mean": r(mean(col("total_p50"))),
            "total_p95_mean": r(mean(col("total_p95"))),
            "total_p99_mean": r(mean(col("total_p99"))),
            "window_wait_p50_mean": r(mean(col("window_wait_p50"))),
            "window_wait_p95_mean": r(mean(col("window_wait_p95"))),
            "cas_retry_mean": r(mean(col("cas_retry_sum"))),
            "repropose_mean": r(mean(col("repropose_sum"))),
            "batch_size_mean": r(mean(col("batch_size_mean")), 3),
            "batch_size_max_max": max(col("batch_size_max")) if col("batch_size_max") else None,
        })

    seed_ok = sum(1 for c in cells if c["seed_pair_ok"])
    lid_ok = sum(1 for c in cells if c["logical_id_decoupled"])
    window_match = sum(1 for c in cells if parse_rid(c["run_id"]) and parse_rid(c["run_id"])["window"] == c["compose_window_ms"])

    raw = {
        "schema": "atm-bench.e3_compare_raw.v1",
        "banner": "DRAFT evidence — not a win claim",
        "n_cells": len(cells),
        "n_missing": len(missing),
        "missing": missing,
        "seed_pair_ok": seed_ok,
        "logical_id_decoupled_ok": lid_ok,
        "window_meta_match": window_match,
        "windows": WINDOWS,
        "cells": cells,
        "aggregate": agg,
    }
    (OUT_DIR / "e3_compare_raw.json").write_text(json.dumps(raw, indent=2) + "\n")
    print(f"cells={len(cells)} missing={len(missing)} seed_ok={seed_ok}/{len(cells)} lid_ok={lid_ok} window_match={window_match}")
    return raw

if __name__ == "__main__":
    main()
