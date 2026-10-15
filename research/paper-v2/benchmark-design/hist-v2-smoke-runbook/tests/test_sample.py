"""Dev-set sampling keeps one row per available class and drops held-out rows."""

import unittest
from pathlib import Path

from hist_v2_smoke_runbook.pins import load_pins
from hist_v2_smoke_runbook.sample import load_items, sample_dev
from hist_v2_smoke_runbook.stage import pilot_overlay

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "dev-items.jsonl"


class SampleTests(unittest.TestCase):
    def test_one_dev_item_per_available_class(self) -> None:
        items, errors = load_items(FIXTURE)
        self.assertEqual(errors, [])
        sample = sample_dev(items, load_pins())
        self.assertEqual(sample["errors"], [])
        self.assertEqual(sample["missing_classes"], [])
        chosen = {row["write_class"]: row["id"] for row in sample["selected"]}
        self.assertEqual(
            chosen,
            {
                "A": "alpha:dev:1_2:a.py",
                "B": "django:dev:5_6:c.py",
                "C": "sympy:dev:7_8:d.py",
                "A'": "django:dev:9_10:e.py",
                "B'": "django:dev:11_12:f.py",
                "D": "django:dev:13_14:g.py",
            },
        )
        refused_projects = {row["project"] for row in sample["refused"]}
        self.assertIn("pallets/flask", refused_projects)
        self.assertIn("requests", refused_projects)
        self.assertTrue(any(row["set"] == "later-period-historical-holdout" for row in sample["refused"]))
        self.assertTrue(any(row["set"] == "held-out-project" for row in sample["refused"]))
        self.assertNotIn("flask", {row["project"].split("/")[-1] for row in sample["selected"]})

    def test_missing_class_is_recorded(self) -> None:
        items, _errors = load_items(FIXTURE)
        kept = [item for item in items if item.get("write_class") != "B'"]
        sample = sample_dev(kept, load_pins())
        self.assertEqual(sample["missing_classes"], ["B'"])
        self.assertNotIn("B'", {row["write_class"] for row in sample["selected"]})

    def test_pilot_cap_stays_on_dev_and_under_thirty(self) -> None:
        items, errors = load_items(FIXTURE)
        self.assertEqual(errors, [])
        rows = []
        for index in range(12):
            base = dict(items[0])
            base["id"] = f"alpha:dev:{index}_x:a.py"
            base["project"] = "alpha" if index % 2 == 0 else "django"
            base["prs"] = [index, index + 100]
            rows.append(base)
        holdout = dict(items[0], id="flask:held:1_2:a.py", project="flask", set="held-out-project", prs=[1, 2])
        triple = dict(items[0], id="alpha:dev:9_10_11:a.py", prs=[1, 2, 3])
        rows.extend([holdout, triple])
        overlay, problems = pilot_overlay(load_pins())
        self.assertEqual(problems, [])
        sample = sample_dev(rows, overlay)
        self.assertEqual(sample["errors"], [])
        self.assertLessEqual(len(sample["selected"]), 30)
        self.assertTrue(all(row["set"] == "dev" for row in sample["selected"]))
        self.assertTrue(all("flask" not in row["project"] for row in sample["selected"]))
        self.assertNotIn("alpha:dev:9_10_11:a.py", {row["id"] for row in sample["selected"]})
        self.assertEqual(sum(1 for row in sample["selected"] if row["write_class"] == "A"), 10)

    def test_rules_mismatch_selects_nothing(self) -> None:
        items, _errors = load_items(FIXTURE)
        items[0] = dict(items[0], rules_sha256="0" * 64)
        sample = sample_dev(items, load_pins())
        self.assertNotEqual(sample["errors"], [])
        self.assertEqual(sample["selected"], [])


if __name__ == "__main__":
    unittest.main()
