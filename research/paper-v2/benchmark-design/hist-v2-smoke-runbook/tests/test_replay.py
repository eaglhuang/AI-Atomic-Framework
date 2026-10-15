"""Dev-item replay accepts a historical binding and refuses catalog fixtures."""

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[5]
sys.path[:0] = [
    str(REPO / "research/paper-v2/benchmark-design/hist-v2-smoke-runbook/src"),
    str(REPO / "research/paper-v2/benchmark-harness/hist-v2-harness-v2/src"),
    str(REPO / "research/paper-v2/benchmark-design/hist-v2-classifier-v8/src"),
]

from hist_v2_harness_v2.patchutil import apply_unified_patch, patch_replace_line  # noqa: E402
from hist_v2_smoke_runbook.pins import load_pins  # noqa: E402
from hist_v2_smoke_runbook.replay import binding_problems, run_bound_cell, sha256_text  # noqa: E402
from hist_v2_smoke_runbook.seal import seal_generation  # noqa: E402


class ReplayBindingTests(unittest.TestCase):
    def test_catalog_id_is_not_a_dev_item(self) -> None:
        item = {
            "id": "disjoint",
            "target_file": "shared.txt",
            "patches": [{"pr": 1, "op": "modify", "code_patch_sha256": "ab", "has_patch_bytes": True}],
            "correct_answer": {"unchanged_base_sha256": "cd", "allowed": []},
        }
        problems = binding_problems([item], Path("/tmp/does-not-matter"))
        self.assertTrue(any("catalog fixture" in problem for problem in problems))

    def test_historical_binding_opens_one_cell(self) -> None:
        item, binding = _historical_item()
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            path = directory / f"{item['id']}.json"
            path.write_text(json.dumps(binding), encoding="utf-8")
            self.assertEqual(binding_problems([item], directory), [])
            outcome = run_bound_cell(
                item,
                path,
                {
                    "item_id": item["id"],
                    "arm": "file_lock",
                    "order": "forward",
                    "inter_arrival_ms": 0,
                    "seed": 0,
                },
            )
            observation = outcome["observation"]
            self.assertTrue(observation["executed"])
            self.assertFalse(observation["catalog_fixture"])
            self.assertEqual(observation["source"], "classifier-v8-dev-replay")
            self.assertIsNone(observation["counterexample"])
            self.assertEqual(observation["proposal_count"], 2)
            self.assertEqual(observation["accepted_ids"], [11, 12])
            self.assertGreater(observation["combined_success_count"], 0)

    def test_nested_historical_path_opens_one_cell(self) -> None:
        item, binding = _historical_item(target="pkg/dir/notes.txt")
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            digest = hashlib.sha256(item["id"].encode("utf-8")).hexdigest()
            path = directory / f"{digest}.json"
            path.write_text(json.dumps(binding), encoding="utf-8")
            self.assertEqual(binding_problems([item], directory), [])
            outcome = run_bound_cell(
                item,
                path,
                {
                    "item_id": item["id"],
                    "arm": "file_lock",
                    "order": "forward",
                    "inter_arrival_ms": 0,
                    "seed": 0,
                },
            )
            self.assertTrue((outcome["workspace"] / "pkg/dir/notes.txt").is_file())
            self.assertIsNone(outcome["observation"]["counterexample"])
            self.assertEqual(outcome["observation"]["accepted_ids"], [11, 12])

    def test_staged_raw_is_inside_the_seal(self) -> None:
        pins = load_pins()
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "sealed"

            def stage_raw(directory: Path) -> None:
                raw = directory / "raw"
                raw.mkdir()
                (raw / "cell.txt").write_text("raw\n", encoding="utf-8")

            code = seal_generation(
                dest,
                date="2026-10-15",
                pins=pins,
                sample={"selected": [], "missing_classes": []},
                plan={"cell_count": 0, "cells": []},
                observations=[],
                stage_raw=stage_raw,
            )
            self.assertEqual(code, 0)
            listed = (dest / "SHA256SUMS").read_text(encoding="utf-8")
            self.assertIn("raw/cell.txt", listed)


def _historical_item(target: str = "notes.txt") -> tuple[dict, dict]:
    base = "red\nblue\ngreen\n"
    first = patch_replace_line(target, base, 0, "RED")
    second = patch_replace_line(target, base, 2, "GREEN")
    body_first = apply_unified_patch(base, first)
    body_second = apply_unified_patch(base, second)
    both = apply_unified_patch(body_first, second)
    item_id = f"replay-unit:dev:11_12:{target}"
    item = {
        "schema_version": "hist-v2-items/8",
        "id": item_id,
        "project": "replay-unit",
        "set": "dev",
        "write_class": "A",
        "target_file": target,
        "rules_sha256": load_pins()["classifier_rules_sha256"],
        "send_order": [11, 12],
        "patches": [
            {"pr": 11, "op": "modify", "code_patch_sha256": sha256_text(first), "has_patch_bytes": True},
            {"pr": 12, "op": "modify", "code_patch_sha256": sha256_text(second), "has_patch_bytes": True},
        ],
        "correct_answer": {
            "unchanged_base_sha256": sha256_text(base),
            "full_reject_allowed": False,
            "allowed": [
                {"set_key": [11], "prs": [11], "sha256": sha256_text(body_first), "maximal": False},
                {"set_key": [12], "prs": [12], "sha256": sha256_text(body_second), "maximal": False},
                {"set_key": [11, 12], "prs": [11, 12], "sha256": sha256_text(both), "maximal": True},
            ],
        },
    }
    binding = {
        "schema": "hist-v2-dev-replay/1",
        "item_id": item_id,
        "catalog_fixture": False,
        "base_text": base,
        "patches": [
            {"pr": 11, "unified_diff": first, "signature": "RED"},
            {"pr": 12, "unified_diff": second, "signature": "GREEN"},
        ],
        "allowed_bodies": {"11": body_first, "12": body_second, "11,12": both},
    }
    return item, binding


if __name__ == "__main__":
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    unittest.main()
