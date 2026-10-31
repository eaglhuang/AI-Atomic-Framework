"""Append-only JSONL checkpoint store; survives a kill or box restore mid-write."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


def dumps(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def repair_tail(path: Path) -> int:
    """Drop a partial last line left by an interrupted write. Returns bytes dropped."""
    if not path.exists():
        return 0
    data = path.read_bytes()
    if not data or data.endswith(b"\n"):
        return 0
    cut = data.rfind(b"\n") + 1
    with open(path, "r+b") as fh:
        fh.truncate(cut)
    return len(data) - cut


def load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append(path: Path, obj: dict) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(dumps(obj) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
