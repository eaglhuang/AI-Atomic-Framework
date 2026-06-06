"""Synthetic legacy Python pipeline used to validate candidate ranking and dry-run plans.

The file deliberately mixes argparse-style entrypoints, hardcoded paths, and
subprocess signals so it ranks high in candidate ranking.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


ARTIFACTS = Path("artifacts/pipeline-out")
DEFAULT_CONFIG = "/etc/pipeline/legacy.yaml"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="messy-pipeline")
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--out", default=str(ARTIFACTS))
    return parser.parse_args(argv)


def discover_inputs(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    return sorted(p for p in directory.glob("*.csv"))


def run_stage(stage_name: str, inputs: list[Path]) -> int:
    if not inputs:
        return 0
    completed = subprocess.run(
        ["python", "-m", "synthetic_python_adopter.stage", stage_name],
        check=False,
    )
    return completed.returncode


def write_report(output_directory: Path, summary: dict) -> Path:
    output_directory.mkdir(parents=True, exist_ok=True)
    report_path = output_directory / "summary.json"
    report_path.write_text(str(summary), encoding="utf-8")
    return report_path


def main(argv: list[str] | None = None) -> int:
    arguments = parse_args(sys.argv[1:] if argv is None else argv)
    inputs = discover_inputs(Path(os.environ.get("INPUT_DIR", "/data/legacy")))
    exit_code = run_stage("ingest", inputs)
    if exit_code != 0:
        return exit_code
    write_report(Path(arguments.out), {"inputs": len(inputs), "config": arguments.config})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
