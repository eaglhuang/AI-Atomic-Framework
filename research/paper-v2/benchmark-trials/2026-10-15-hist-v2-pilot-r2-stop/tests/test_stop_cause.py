"""Read-only reproduction of the pilot-r2 stop. Does not rerun a cell."""

import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT
while REPO != REPO.parent and not (REPO / "atm.mjs").is_file():
    REPO = REPO.parent

import sys

sys.path.insert(0, str(REPO / "research/paper-v2/benchmark-harness/hist-v2-harness-v3/src"))
sys.path.insert(0, str(REPO / "research/paper-v2/benchmark-design/hist-v2-classifier-v8/src"))
sys.path.insert(0, str(REPO / "research/paper-v2/benchmark-design/hist-v2-pilot-r2/src"))

from hist_v2_classify_v8.score import proposal_final_report  # noqa: E402
from hist_v2_harness_v3.scoring import acceptance_entry, answer_from_fixture  # noqa: E402
from hist_v2_pilot_r2.runner import binding_path, fixture_from_binding  # noqa: E402

ITEM = "django:dev:17554_18450:django/db/models/fields/related_descriptors.py"
CELL = (
    "django_dev_17554_18450_django_db_models_fields_related_descriptors.py"
    "__textual_merge_file__reverse__500__s0"
)
STEWARD = (
    "django_dev_17554_18450_django_db_models_fields_related_descriptors.py"
    "__steward__reverse__500__s0"
)
PAIR = "4eebe97c7539c93d75aad6070c09be042329218f85e55260ffc1005d58424274"
PILOT_SUMS = "e44080d174d2ab69ab233bb6764e419d0404a2ae1d1bd0173bf7f3dc3c1fe6d9"
V3_SUMS = "07a8f10f9894aa64faf42f7aef3daf33c7c685151e9b3318d9bedb1dbad18a59"


def _pilot() -> Path:
    return REPO / "research/paper-v2/benchmark-trials/2026-10-15-hist-v2-pilot-r2"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _item() -> dict:
    for line in (REPO / "research/paper-v2/benchmark-main/2026-10-15-hist-v2-classify-v8/items.jsonl").read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if row.get("id") == ITEM:
            return row
    raise AssertionError(ITEM)


def _score(results: list[dict], body: str) -> list[dict]:
    fixture = fixture_from_binding(_item(), _load(binding_path(ITEM)))
    accepted = sorted(row["proposal_id"] for row in results if row["accepted"])
    acked = any(row["accepted"] and row["ack_at"] is not None for row in results)
    answer = answer_from_fixture(fixture)
    acceptance = acceptance_entry(accepted, body, acked)
    first = min(row["first_submit"] for row in results)
    reports = []
    for row in results:
        event = {
            "send_time": row["first_submit"],
            "first_submit_time": row["first_submit"],
            "item_stop_time": first + 30.0,
            "entry_points_stopped": True,
            "live_entry_points": [],
            "rename_time": row["rename_at"],
            "ack_time": row["ack_at"],
        }
        report = proposal_final_report(event, answer, acceptance)
        reports.append(report)
    return reports


class StopCauseTests(unittest.TestCase):
    def test_sealed_generations_were_not_rewritten(self) -> None:
        pilot_sums = hashlib.sha256((_pilot() / "SHA256SUMS").read_bytes()).hexdigest()
        harness_sums = hashlib.sha256(
            (REPO / "research/paper-v2/benchmark-harness/hist-v2-harness-v3/SHA256SUMS").read_bytes()
        ).hexdigest()
        self.assertEqual(pilot_sums, PILOT_SUMS)
        self.assertEqual(harness_sums, V3_SUMS)

    def test_gap_is_inside_the_arrival_sleep_not_the_merge(self) -> None:
        cell = _pilot() / "raw/cells" / CELL
        job_gap = (cell / "job-18450.json").stat().st_mtime - (cell / "job-17554.json").stat().st_mtime
        barrier_gap = (cell / "barrier/ready-18450").stat().st_mtime - (cell / "barrier/ready-17554").stat().st_mtime
        self.assertLess(abs(job_gap), 0.05)
        self.assertLess(abs(barrier_gap), 0.05)
        early = _load(cell / "results/17554.json")
        late = _load(cell / "results/18450.json")
        job = _load(cell / "job-18450.json")
        self.assertAlmostEqual(job["arrival_delay_ms"], 506.5311778040528, places=3)
        self.assertGreater(late["first_submit"] - early["first_submit"], 100)
        self.assertLess(late["metrics"]["lock_wait_ms"], 1)
        self.assertLess(late["metrics"]["lock_hold_ms"], 100)
        self.assertEqual(late["retries"], 0)
        self.assertEqual(early["arm_terminal"], "committed")
        self.assertEqual(late["arm_terminal"], "committed")

    def test_bytes_match_the_pair_and_steward_but_the_late_clock_is_inconsistent(self) -> None:
        cell = _pilot() / "raw/cells" / CELL
        body = (cell / "django/db/models/fields/related_descriptors.py").read_text(encoding="utf-8")
        self.assertEqual(hashlib.sha256(body.encode("utf-8")).hexdigest(), PAIR)
        binding = _load(binding_path(ITEM))
        self.assertEqual(body, binding["allowed_bodies"]["17554,18450"])
        steward = _pilot() / "raw/cells" / STEWARD
        steward_body = (steward / "django/db/models/fields/related_descriptors.py").read_text(encoding="utf-8")
        self.assertEqual(hashlib.sha256(steward_body.encode("utf-8")).hexdigest(), PAIR)
        left = _load(steward / "results/17554.json")
        right = _load(steward / "results/18450.json")
        self.assertLess(abs(right["first_submit"] - left["first_submit"]), 0.05)

        results = [_load(cell / "results/17554.json"), _load(cell / "results/18450.json")]
        early, late = _score(results, body)
        self.assertEqual(early["status"], "success")
        self.assertTrue(early["counts_as_success"])
        self.assertEqual(late["status"], "inconsistent")
        self.assertFalse(late["counts_as_success"])
        self.assertEqual(late["mismatch"], ["inconsistent:ack"])
        self.assertEqual(late["terminal"]["terminal"], "late-commit-after-timeout")
        self.assertEqual(late["terminal"]["stop_reason"], "rename-after-stop")
        self.assertIs(late["terminal"]["acked"], False)

    def test_only_this_cell_has_a_first_submit_gap_past_the_shared_window(self) -> None:
        huge = []
        root = _pilot() / "raw/cells"
        for cell in root.iterdir():
            rows = [_load(path) for path in (cell / "results").glob("*.json")]
            if len(rows) < 2:
                continue
            rows.sort(key=lambda row: row["first_submit"])
            gap = rows[1]["first_submit"] - rows[0]["first_submit"]
            if gap > 30:
                huge.append(cell.name)
        self.assertEqual(huge, [CELL])

    def test_the_same_bytes_score_success_when_the_gap_is_the_scheduled_delay(self) -> None:
        cell = _pilot() / "raw/cells" / CELL
        body = (cell / "django/db/models/fields/related_descriptors.py").read_text(encoding="utf-8")
        early = _load(cell / "results/17554.json")
        late = dict(_load(cell / "results/18450.json"))
        work_ack = late["ack_at"] - late["first_submit"]
        work_rename = late["rename_at"] - late["first_submit"]
        late["first_submit"] = early["first_submit"] + 0.5065311778040528
        late["ack_at"] = late["first_submit"] + work_ack
        late["rename_at"] = late["first_submit"] + work_rename
        reports = _score([early, late], body)
        self.assertEqual([row["status"] for row in reports], ["success", "success"])
        self.assertTrue(all(row["counts_as_success"] for row in reports))


if __name__ == "__main__":
    unittest.main()
