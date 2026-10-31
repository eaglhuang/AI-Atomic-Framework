"""GitHub REST transport. Tests inject a fake; production shells out to `gh api`.

The transport never reads credential files; `gh` handles auth itself.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any, Protocol


class TransportError(RuntimeError):
    def __init__(self, path: str, message: str, status: int | None = None):
        super().__init__(f"{path}: {message}")
        self.path = path
        self.status = status


class Transport(Protocol):
    def get(self, path: str) -> Any: ...


class GhTransport:
    """Calls `gh api <path>`; one call per request, no automatic pagination."""

    def __init__(self, gh: str = "gh", timeout_s: float = 60.0):
        self.gh = gh
        self.timeout_s = timeout_s
        self.calls = 0

    def get(self, path: str) -> Any:
        self.calls += 1
        proc = subprocess.run(
            [self.gh, "api", "-H", "Accept: application/vnd.github+json", path],
            capture_output=True,
            text=True,
            timeout=self.timeout_s,
        )
        if proc.returncode != 0:
            status = None
            err = (proc.stderr or "").strip()
            for code in (404, 403, 422, 429, 500, 502, 503):
                if f"HTTP {code}" in err:
                    status = code
                    break
            raise TransportError(path, err[-300:] or "gh api failed", status)
        return json.loads(proc.stdout)
