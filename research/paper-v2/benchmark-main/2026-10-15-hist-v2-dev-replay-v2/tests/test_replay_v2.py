"""Sealed hist-v2-dev-replay/2 bindings for the 29 pilot items. v1 stays sealed."""

import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[3]
V1 = REPO / "research/paper-v2/benchmark-main/2026-10-15-hist-v2-classify-v8"
HARNESS = REPO / "research/paper-v2/benchmark-harness/hist-v2-harness-v3/src"
CLASSIFIER = REPO / "research/paper-v2/benchmark-design/hist-v2-classifier-v8/src"
import sys

sys.path.insert(0, str(HARNESS))
sys.path.insert(0, str(CLASSIFIER))

from hist_v2_harness_v3.merge import git_merge_file  # noqa: E402
from hist_v2_harness_v3.patchutil import PatchApplyError, apply_unified_patch  # noqa: E402


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def binding_name(item_id: str) -> str:
    return hashlib.sha256(item_id.encode("utf-8")).hexdigest() + ".json"


class ReplayV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ids = (ROOT / "ITEM_IDS.txt").read_text(encoding="utf-8").splitlines()
        cls.items = {}
        wanted = set(cls.ids)
        for line in (V1 / "items.jsonl").read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("id") in wanted:
                cls.items[row["id"]] = row
        cls.v1_sums = {}
        for line in (V1 / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
            if "dev-replay-bindings/" not in line:
                continue
            digest, path = line.split("  ", 1)
            cls.v1_sums[path] = digest

    def test_exactly_the_sealed_pilot_items(self) -> None:
        seen = []
        known = set()
        obs = REPO / "research/paper-v2/benchmark-trials/2026-10-15-hist-v2-pilot/observations.jsonl"
        for line in obs.read_text(encoding="utf-8").splitlines():
            item_id = json.loads(line)["item_id"]
            if item_id not in known:
                known.add(item_id)
                seen.append(item_id)
        self.assertEqual(self.ids, seen)
        self.assertEqual(len(self.ids), 29)

    def test_each_binding_keeps_v1_diff_and_adds_endpoints(self) -> None:
        for item_id in self.ids:
            path = ROOT / "bindings" / binding_name(item_id)
            binding = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(binding["schema"], "hist-v2-dev-replay/2")
            self.assertIs(binding["catalog_fixture"], False)
            self.assertEqual(binding["item_id"], item_id)
            item = self.items[item_id]
            self.assertEqual(item["set"], "dev")
            self.assertNotIn(item["set"], ("held-out", "held-out-project", "later-period-historical-holdout"))
            answer = item["correct_answer"]
            self.assertEqual(sha256_text(binding["base_text"]), answer["unchanged_base_sha256"])
            by_pr = {int(row["pr"]): row for row in binding["patches"]}
            self.assertEqual(set(by_pr), {int(row["pr"]) for row in item["patches"]})
            for patch in item["patches"]:
                row = by_pr[int(patch["pr"])]
                self.assertEqual(sha256_text(row["unified_diff"]), patch["code_patch_sha256"])
                self.assertEqual(row["selected_mb"], patch["selected_mb"])
                self.assertEqual(row["selected_head"], patch["selected_head"])
                self.assertIsInstance(row["parent_text"], str)
                self.assertIsInstance(row["head_text"], str)
                self.assertTrue(row["parent_text"])
                self.assertTrue(row["head_text"])
                key = str(int(patch["pr"]))
                code, merged = git_merge_file(binding["base_text"], row["parent_text"], row["head_text"])
                self.assertEqual(code, 0, item_id)
                self.assertEqual(merged, binding["allowed_bodies"][key], item_id)

    def test_v1_binding_bytes_still_match_the_classifier_seal(self) -> None:
        for item_id in self.ids:
            rel = f"dev-replay-bindings/{binding_name(item_id)}"
            path = V1 / rel
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(digest, self.v1_sums[rel])

    def test_known_context_mismatch_still_fails_the_two_way_apply(self) -> None:
        item_id = "django:dev:15705_16703:django/db/models/query.py"
        binding = json.loads((ROOT / "bindings" / binding_name(item_id)).read_text(encoding="utf-8"))
        row = next(patch for patch in binding["patches"] if patch["pr"] == 16703)
        with self.assertRaises(PatchApplyError):
            apply_unified_patch(binding["base_text"], row["unified_diff"])


if __name__ == "__main__":
    unittest.main()
