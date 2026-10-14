"""A fixture seal verifies, and a counterexample is not overwritten."""

import subprocess
import tempfile
import unittest
from pathlib import Path

from hist_v2_smoke_runbook.pins import load_pins
from hist_v2_smoke_runbook.plan import build_plan
from hist_v2_smoke_runbook.preflight import sha256_file
from hist_v2_smoke_runbook.sample import load_items, sample_dev
from hist_v2_smoke_runbook.seal import OverwriteRefused, seal_generation

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "dev-items.jsonl"


class SealTests(unittest.TestCase):
    def test_counterexample_aliases(self) -> None:
        from hist_v2_smoke_runbook.stop_report import counterexamples_from

        rows = counterexamples_from(
            [
                {"counterexample": "lost effect", "item_id": "a", "arm": "atm"},
                {"counterexample": "損壞", "item_id": "b", "arm": "file_lock"},
            ]
        )
        self.assertEqual([row["kind"] for row in rows], ["lost-effect", "corruption"])

    def test_fixture_generation_verify_passes(self) -> None:
        pins = load_pins()
        items, errors = load_items(FIXTURE)
        self.assertEqual(errors, [])
        sample = sample_dev(items, pins)
        plan = build_plan(sample["selected"], pins)
        observations = [_observation(cell) for cell in plan["cells"][:2]]
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "2026-10-14-hist-v2-smoke"
            code = seal_generation(
                dest,
                date="2026-10-14",
                pins=pins,
                sample=sample,
                plan=plan,
                observations=observations,
                deviations=[],
            )
            self.assertEqual(code, 0)
            first = (dest / "GENERATION.md").read_text(encoding="utf-8").splitlines()[0]
            self.assertEqual(first, pins["trial_banner"])
            report = (dest / "STOP_REPORT.md").read_text(encoding="utf-8")
            self.assertTrue(report.startswith(pins["trial_banner"]))
            self.assertIn("combined_success", report)
            self.assertNotIn("較優", report)
            self.assertNotIn("優勝", report)
            proc = subprocess.run(["sh", str(dest / "verify.sh"), str(dest)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertIn("OK:", proc.stdout)
            target = dest / "STOP_REPORT.md"
            target.write_text(target.read_text(encoding="utf-8") + "\n", encoding="utf-8")
            failed = subprocess.run(["sh", str(dest / "verify.sh"), str(dest)], capture_output=True, text=True)
            self.assertNotEqual(failed.returncode, 0)

    def test_counterexample_is_preserved(self) -> None:
        pins = load_pins()
        items, _errors = load_items(FIXTURE)
        sample = sample_dev(items, pins)
        plan = build_plan(sample["selected"], pins)
        observation = _observation(plan["cells"][0])
        observation["counterexample"] = "inconsistent"
        observation["counterexample_detail"] = {"status": "inconsistent"}
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "sealed"
            code = seal_generation(
                dest,
                date="2026-10-14",
                pins=pins,
                sample=sample,
                plan=plan,
                observations=[observation],
            )
            self.assertEqual(code, 6)
            forensic = dest / "FORENSIC.json"
            self.assertTrue(forensic.is_file())
            digest = sha256_file(forensic)
            with self.assertRaises(OverwriteRefused):
                seal_generation(
                    dest,
                    date="2026-10-14",
                    pins=pins,
                    sample=sample,
                    plan=plan,
                    observations=[observation],
                )
            self.assertEqual(sha256_file(forensic), digest)
            proc = subprocess.run(["sh", str(dest / "verify.sh"), str(dest)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)


def _observation(cell: dict) -> dict:
    return {
        "item_id": cell["item_id"],
        "write_class": cell["write_class"],
        "arm": cell["arm"],
        "seed": cell["seed"],
        "order": cell["order"],
        "inter_arrival_ms": cell["inter_arrival_ms"],
        "proposal_count": 2,
        "combined_success_count": 0,
        "batch_sizes": [1],
        "terminals": ["rejected"],
        "executed": False,
        "source": "unit-fixture",
        "counterexample": None,
    }


if __name__ == "__main__":
    unittest.main()
