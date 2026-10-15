"""Packaged pins match the sealed inputs. A bad pin does not create a directory."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from hist_v2_smoke_runbook.pins import load_pins, runbook_root
from hist_v2_smoke_runbook.preflight import check_pins, sha256_file

REPO = Path(os.environ.get("HIST_V2_REPO_ROOT", Path(__file__).resolve().parents[5]))


class PreflightTests(unittest.TestCase):
    def test_packaged_pins_match_this_checkout(self) -> None:
        pins = load_pins()
        self.assertEqual(check_pins(REPO, pins), [])
        rules = REPO / pins["classifier_rules"]
        self.assertEqual(sha256_file(rules), pins["classifier_rules_sha256"])

    def test_runbook_directory_verifies(self) -> None:
        script = runbook_root() / "verify.sh"
        proc = subprocess.run(["sh", str(script), str(runbook_root())], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("OK:", proc.stdout)

    def test_rules_mismatch_is_a_failure(self) -> None:
        pins = load_pins()
        pins["classifier_rules_sha256"] = "0" * 64
        failures = check_pins(REPO, pins)
        self.assertTrue(any(item.startswith("classifier:") for item in failures))


class CliPinTests(unittest.TestCase):
    def test_cli_mismatch_creates_no_directory(self) -> None:
        pins = load_pins()
        pins["harness_sha256sums_sha256"] = "f" * 64
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pin_path = root / "pins.json"
            out = root / "not-created"
            pin_path.write_text(json.dumps(pins), encoding="utf-8")
            proc = _cli("--pins", str(pin_path), "--out", str(out), "--stage", "check")
            self.assertEqual(proc.returncode, 1, proc.stderr)
            self.assertIn("PIN_MISMATCH", proc.stderr)
            self.assertIn("no run directory created", proc.stderr)
            self.assertFalse(out.exists())

    def test_forbidden_stage_creates_no_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "pilot-out"
            proc = _cli("--stage", "pilot", "--out", str(out), "--execute")
            self.assertEqual(proc.returncode, 2, proc.stderr)
            self.assertIn("no run directory created", proc.stderr)
            self.assertFalse(out.exists())

    def test_execute_without_approval_creates_no_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "smoke-out"
            env = _env()
            env.pop("HIST_V2_SMOKE_AUTHOR_APPROVAL", None)
            proc = _cli("--execute", "--stage", "smoke", "--out", str(out), "--date", "2026-10-14", env=env)
            self.assertEqual(proc.returncode, 3, proc.stderr)
            self.assertIn("author approval missing", proc.stderr)
            self.assertFalse(out.exists())

    def test_execute_with_approval_still_does_not_start_a_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "2026-10-14-hist-v2-smoke"
            env = _env()
            env["HIST_V2_SMOKE_AUTHOR_APPROVAL"] = load_pins()["approval_value"]
            proc = _cli("--execute", "--stage", "smoke", "--out", str(out), "--date", "2026-10-14", env=env)
            self.assertEqual(proc.returncode, 4, proc.stderr)
            self.assertIn("no run directory created", proc.stderr)
            self.assertFalse(out.exists())

    def test_execute_with_unbound_dev_items_creates_no_directory(self) -> None:
        trials = REPO / "research/paper-v2/benchmark-trials"
        before = _smoke_generation_sums(trials)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "2026-10-15-hist-v2-smoke"
            env = _env()
            env["HIST_V2_SMOKE_AUTHOR_APPROVAL"] = load_pins()["approval_value"]
            proc = _cli(
                "--execute",
                "--stage",
                "smoke",
                "--items",
                str(Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "dev-items.jsonl"),
                "--binding",
                str(Path(tmp) / "binding"),
                "--out",
                str(out),
                "--date",
                "2026-10-15",
                env=env,
            )
            self.assertEqual(proc.returncode, 4, proc.stderr)
            self.assertIn("catalog fixtures are not a substitute", proc.stderr)
            self.assertIn("no run directory created", proc.stderr)
            self.assertFalse(out.exists())
        self.assertEqual(_smoke_generation_sums(trials), before)

    def test_shell_entry_refuses_held_out(self) -> None:
        script = runbook_root() / "run_smoke.sh"
        proc = subprocess.run(
            ["sh", str(script), "--stage", "held-out"],
            cwd=REPO,
            capture_output=True,
            text=True,
            env=_env(),
        )
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("no run directory created", proc.stderr)


def _smoke_generation_sums(trials: Path) -> dict[str, str]:
    if not trials.is_dir():
        return {}
    found: dict[str, str] = {}
    for path in sorted(trials.glob("*hist-v2-smoke*")):
        sums = path / "SHA256SUMS"
        found[path.name] = sha256_file(sums) if sums.is_file() else ""
    return found


def _env() -> dict[str, str]:
    env = os.environ.copy()
    env["HIST_V2_REPO_ROOT"] = str(REPO)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    root = runbook_root()
    entries = [
        str(root / "src"),
        str(REPO / "research/paper-v2/benchmark-harness/hist-v2-harness-v2/src"),
        str(REPO / "research/paper-v2/benchmark-design/hist-v2-classifier-v8/src"),
    ]
    env["PYTHONPATH"] = os.pathsep.join(entries + ([env["PYTHONPATH"]] if env.get("PYTHONPATH") else []))
    return env


def _cli(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "hist_v2_smoke_runbook", *args],
        cwd=REPO,
        capture_output=True,
        text=True,
        env=env or _env(),
    )


if __name__ == "__main__":
    unittest.main()
