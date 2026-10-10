"""Write sealable classifier outputs. Byte oracles only; never arm results."""

from __future__ import annotations

import hashlib
import json
import os
from collections import Counter

from .parameters import CANONICAL_DESIGN


def write_outputs(out_dir: str, items: list[dict], excluded: list[dict], rules_sha256: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    expected_root = os.path.join(out_dir, "expected")
    os.makedirs(expected_root, exist_ok=True)
    manifest = []
    for item in items:
        blobs = item.pop("_blobs", {})
        _bind_expected(out_dir, item, blobs, manifest)
    _write_jsonl(os.path.join(out_dir, "items.jsonl"), items)
    _write_jsonl(os.path.join(out_dir, "excluded.jsonl"), excluded)
    _write_jsonl(os.path.join(expected_root, "manifest.jsonl"), manifest)
    summary = build_summary(items, excluded, rules_sha256)
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    return summary


def build_summary(items: list[dict], excluded: list[dict], rules_sha256: str) -> dict:
    by_class = Counter(item["write_class"] for item in items)
    by_flag = Counter(item["semantic_flag"] for item in items)
    by_stratum = Counter("null" if item["stratum"] is None else item["stratum"] for item in items)
    by_set = Counter(item["set"] for item in items)
    by_reason = Counter(row["reason"] for row in excluded)
    grouping = Counter(code for item in items for code in item["grouping_codes"])
    by_project: dict[str, dict] = {}
    for item in items:
        bucket = by_project.setdefault(
            item["project"],
            {"items": 0, "by_write_class": {}, "by_semantic_flag": {}},
        )
        bucket["items"] += 1
    for project, bucket in by_project.items():
        project_items = [item for item in items if item["project"] == project]
        bucket["by_write_class"] = dict(Counter(item["write_class"] for item in project_items))
        bucket["by_semantic_flag"] = dict(Counter(item["semantic_flag"] for item in project_items))
    return {
        "schema_version": "hist-v2-summary/1",
        "design_status": "draft-not-frozen-prereg",
        "claims_benchmark_wins": False,
        "ran_benchmark_arms": False,
        "canonical_design": CANONICAL_DESIGN,
        "rules_sha256": rules_sha256,
        "item_count": len(items),
        "excluded_count": len(excluded),
        "by_write_class": dict(by_class),
        "by_semantic_flag": dict(by_flag),
        "by_stratum": dict(by_stratum),
        "by_set": dict(by_set),
        "by_project": by_project,
        "excluded_by_reason": dict(by_reason),
        "grouping_counts": dict(grouping),
    }


def _bind_expected(out_dir: str, item: dict, blobs: dict, manifest: list) -> None:
    answer = item["correct_answer"]
    folder = hashlib.sha256(item["id"].encode("utf-8")).hexdigest()[:24]
    written = {}
    for key, blob in blobs.items():
        rel = f"expected/{folder}/{key}.bytes"
        dest = os.path.join(out_dir, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as handle:
            handle.write(blob)
        digest = hashlib.sha256(blob).hexdigest()
        written[key] = rel
        manifest.append({"id": item["id"], "blob_key": key, "sha256": digest, "path": rel})
    if "blob_key" in answer:
        answer["expected_relpath"] = written[answer.pop("blob_key")]
    for row in answer.get("allowed") or []:
        if "blob_key" in row:
            row["expected_relpath"] = written[row.pop("blob_key")]
    for row in answer.get("orders") or []:
        if "blob_key" in row:
            row["expected_relpath"] = written[row.pop("blob_key")]


def _write_jsonl(path: str, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            handle.write("\n")
