"""Dataset-level pass for exclusion rule A (sensitivity imputation).

Primary analysis uses only records with derived.timeline_ok. For the
sensitivity analysis every excluded record gets
    t_start_imputed = created_at - M,
where M = median dev_seconds over timeline_ok records of the same dataset,
rounded to the nearest second (round-half-even). Included records keep
t_start_sens = t_start and t_start_imputed = null. Nothing is deleted.
"""

from __future__ import annotations

import statistics
from datetime import timedelta

from .derive import EXCLUDING_REASONS, EXCLUSION_RULE_ID, parse_ts


def fmt(dt) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def apply(records: list[dict]) -> dict:
    clean = [r["derived"]["dev_seconds"] for r in records if r["derived"]["timeline_ok"]]
    med = int(round(statistics.median(clean))) if clean else None
    reasons: dict[str, int] = {}
    excluded = 0
    for r in records:
        d = r["derived"]
        if d["timeline_ok"]:
            d["t_start_imputed"] = None
            d["t_start_sens"] = d["t_start"]
            continue
        excluded += 1
        for x in d["exclusion_reasons"]:
            reasons[x] = reasons.get(x, 0) + 1
        if med is None:
            d["t_start_imputed"] = d["t_start_sens"] = None
        else:
            v = fmt(parse_ts(r["raw"]["created_at"]) - timedelta(seconds=med))
            d["t_start_imputed"] = d["t_start_sens"] = v
    n = len(records)
    return {
        "rule": EXCLUSION_RULE_ID,
        "excluding_reasons": list(EXCLUDING_REASONS),
        "records": n,
        "timeline_ok": n - excluded,
        "excluded": excluded,
        "exclusion_rate": round(excluded / n, 4) if n else None,
        "reason_counts": dict(sorted(reasons.items())),
        "imputation_median_dev_seconds": med,
    }
