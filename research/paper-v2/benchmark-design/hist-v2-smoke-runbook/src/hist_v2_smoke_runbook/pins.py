"""Load the smoke pin file. Pins are data, not a second registry."""

import json
from pathlib import Path


def runbook_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_pins(path: Path | None = None) -> dict:
    pin_path = path or (runbook_root() / "pins.json")
    return json.loads(pin_path.read_text(encoding="utf-8"))
