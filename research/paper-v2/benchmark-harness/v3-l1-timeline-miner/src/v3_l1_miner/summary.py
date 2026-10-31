"""Descriptive summary of a derived timelines dataset (no outcome analysis)."""

from __future__ import annotations

import statistics


def _q(vals: list) -> dict | None:
    if not vals:
        return None
    vals = sorted(vals)
    qs = statistics.quantiles(vals, n=4, method="inclusive") if len(vals) > 1 else [vals[0]] * 3
    return {"n": len(vals), "min": vals[0], "p25": qs[0], "median": qs[1], "p75": qs[2],
            "max": vals[-1], "mean": round(statistics.fmean(vals), 3)}


def summarize(records: list[dict], sens_meta: dict) -> dict:
    flags: dict[str, int] = {}
    for r in records:
        for f in r["derived"]["flags"]:
            flags[f] = flags.get(f, 0) + 1
    n = len(records)
    ok = [r for r in records if r["derived"]["timeline_ok"]]

    def claim_stats(rs):
        s1 = [len(r["derived"]["s1_files"]) for r in rs]
        s2 = [len(r["derived"]["s2_files"]) for r in rs]
        s3 = [len(r["derived"]["s3_dirs"]) for r in rs]
        recall, precision, subset = [], [], 0
        for r in rs:
            a, b = set(r["derived"]["s1_files"]), set(r["derived"]["s2_files"])
            if a <= b:
                subset += 1
            if b:
                recall.append(round(len(a & b) / len(b), 4))
            if a:
                precision.append(round(len(a & b) / len(a), 4))
        return {"s1_size": _q(s1), "s2_size": _q(s2), "s3_size": _q(s3),
                "s1_subset_of_s2_rate": round(subset / len(rs), 4) if rs else None,
                "s1_recall_of_s2": _q(recall), "s1_precision_vs_s2": _q(precision),
                "s1_equals_s2_rate": round(sum(set(r["derived"]["s1_files"]) == set(r["derived"]["s2_files"]) for r in rs) / len(rs), 4) if rs else None}

    return {
        "records": n,
        "flag_counts": dict(sorted(flags.items())),
        "flag_rates": {k: round(v / n, 4) for k, v in sorted(flags.items())} if n else {},
        "rule_a": sens_meta,
        "dev_seconds_timeline_ok": _q([r["derived"]["dev_seconds"] for r in ok]),
        "dev_seconds_all_defined": _q([r["derived"]["dev_seconds"] for r in records if r["derived"]["dev_seconds"] is not None]),
        "own_commits": _q([r["derived"]["n_commits_fetched"] - r["derived"]["n_merge_commits"] for r in records]),
        "total_lines": _q([r["derived"]["total_lines"] for r in records]),
        "force_pushes": _q([r["derived"]["n_force_pushes"] for r in records if r["derived"]["n_force_pushes"] is not None]),
        "claim_sets_all": claim_stats(records),
        "claim_sets_timeline_ok": claim_stats(ok),
        "api_calls_recorded": sum(r["raw"].get("api_calls", 0) for r in records),
    }
