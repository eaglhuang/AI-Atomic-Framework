from __future__ import annotations

import json
import shutil
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

from v3_l1_miner.transport import TransportError  # noqa: E402

FIX = HERE / "fixtures"
SCRATCH = HERE / ".scratch"  # never the system /tmp


@contextmanager
def scratch_dir():
    SCRATCH.mkdir(exist_ok=True)
    d = Path(tempfile.mkdtemp(dir=SCRATCH))
    try:
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)
        try:
            SCRATCH.rmdir()
        except OSError:
            pass


def load_fix(*parts: str):
    return json.loads(FIX.joinpath(*parts).read_text(encoding="utf-8"))


class FakeTransport:
    def __init__(self, routes: dict, fail: dict | None = None):
        self.routes = routes
        self.fail = dict(fail or {})  # path -> list of statuses to raise first
        self.log: list[str] = []

    def get(self, path: str):
        self.log.append(path)
        pending = self.fail.get(path)
        if pending:
            raise TransportError(path, "fake", pending.pop(0))
        if path not in self.routes:
            raise TransportError(path, "HTTP 404", 404)
        return json.loads(json.dumps(self.routes[path]))


def django_15705_routes() -> dict:
    base = "repos/django/django"
    return {
        f"{base}/pulls/15705": load_fix("django-15705", "pull.json"),
        f"{base}/pulls/15705/commits?per_page=100&page=1": load_fix("django-15705", "pull-commits.json"),
        f"{base}/pulls/15705/files?per_page=100&page=1": load_fix("django-15705", "pull-files.json"),
        f"{base}/commits/abd214b86ecac33a7f608e99f63faaa8d812ff72": load_fix("django-15705", "commit-abd214b8.json"),
        f"{base}/commits/8b8fe3c1e9cbb911f49e13251e41a355a1a01f93": load_fix("django-15705", "commit-8b8fe3c1.json"),
        "rate_limit": {"resources": {"core": {"remaining": 4000, "reset": 0}}},
    }


def sha(i: int) -> str:
    return f"{i:040x}"


def synth_commit(i: int, author: str, committer: str | None = None, parents: int = 1) -> dict:
    return {"sha": sha(i), "commit": {"author": {"date": author}, "committer": {"date": committer or author}},
            "parents": [{"sha": sha(1000 + i + k)} for k in range(parents)]}
