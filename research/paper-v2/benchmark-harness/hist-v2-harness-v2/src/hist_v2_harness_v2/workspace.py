"""One fixture workspace. Runs write only under this temporary directory."""

import json
from pathlib import Path


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def append_event(workspace: Path, event: dict) -> None:
    path = workspace / "events.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, sort_keys=True) + "\n")


def prepare_workspace(root: Path, fixture: dict) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    target = root / fixture["filename"]
    if fixture.get("base_absent"):
        if target.exists():
            target.unlink()
    else:
        target.write_text(fixture["base"], encoding="utf-8")
    (root / "inbox").mkdir(exist_ok=True)
    (root / "results").mkdir(exist_ok=True)
    return target
