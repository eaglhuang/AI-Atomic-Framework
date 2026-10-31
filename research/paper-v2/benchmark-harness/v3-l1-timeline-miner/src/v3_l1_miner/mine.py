"""Resumable mining loop with rate-limit back-off and a held-out guard."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from . import MINER_VERSION, SCHEMA_ID, store
from .derive import derive
from .fetch import fetch_pull, normalize
from .transport import Transport, TransportError

# prereg v3 section 6.1: flask and requests are the held-out set; nothing may be
# mined from them during development without an explicit, recorded opt-in.
HOLDOUT_REPOS = frozenset({"pallets/flask", "psf/requests"})


class HoldoutRefused(RuntimeError):
    pass


def build_record(raw_norm: dict, fetched_at: str) -> dict:
    return {
        "schema": SCHEMA_ID,
        "miner_version": MINER_VERSION,
        "fetched_at": fetched_at,
        "raw": raw_norm,
        "derived": derive(raw_norm),
    }


@dataclass
class Miner:
    transport: Transport
    out_dir: Path
    repo: str
    allow_holdout: bool = False
    max_calls: int | None = None
    events: bool = False
    rate_reserve: int = 50
    sleep: Callable[[float], None] = time.sleep
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)
    log: Callable[[str], None] = lambda msg: None
    calls: int = 0
    stats: dict = field(default_factory=lambda: {"mined": 0, "skipped": 0, "errors": 0})

    def __post_init__(self) -> None:
        if self.repo in HOLDOUT_REPOS and not self.allow_holdout:
            raise HoldoutRefused(f"{self.repo} is held-out (prereg v3 §6.1); pass --allow-holdout only after the dev set is frozen")
        resolved = self.out_dir.resolve()
        if resolved == Path("/tmp") or Path("/tmp") in resolved.parents:
            raise ValueError("refusing to write under top-level /tmp")
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.timelines = self.out_dir / "timelines.jsonl"
        self.errors = self.out_dir / "errors.jsonl"

    def _rate_wait(self) -> None:
        try:
            core = self.transport.get("rate_limit")["resources"]["core"]
        except Exception as exc:  # rate probe failure is not fatal; back off a minute
            self.log(f"rate_limit probe failed: {exc}")
            self.sleep(60)
            return
        self.calls += 1
        if core["remaining"] <= self.rate_reserve:
            wait = max(0, core["reset"] - int(self.now().timestamp())) + 5
            self.log(f"rate limit low ({core['remaining']}); sleeping {wait}s")
            self.sleep(wait)

    def _fetch_with_retry(self, number: int):
        last: Exception | None = None
        for attempt in range(2):
            try:
                return fetch_pull(self.transport, self.repo, number, events=self.events)
            except TransportError as exc:
                last = exc
                if exc.status == 404:
                    raise
                if exc.status in (403, 429):
                    self._rate_wait()
                else:
                    self.sleep(5 * (attempt + 1))
        assert last is not None
        raise last

    def run(self, numbers: list[int]) -> dict:
        dropped = store.repair_tail(self.timelines)
        if dropped:
            self.log(f"repaired partial last line ({dropped} bytes)")
        done = {r["raw"]["number"] for r in store.load(self.timelines)}
        started = self.now().strftime("%Y-%m-%dT%H:%M:%SZ")
        for i, number in enumerate(numbers):
            if number in done:
                self.stats["skipped"] += 1
                continue
            if self.max_calls is not None and self.calls >= self.max_calls:
                self.log("max-calls reached; stopping (resume later)")
                break
            if i and i % 25 == 0:
                self._rate_wait()
            try:
                raw = self._fetch_with_retry(number)
            except TransportError as exc:
                self.stats["errors"] += 1
                store.append(self.errors, {"repo": self.repo, "number": number,
                                           "status": exc.status, "error": str(exc)[-300:]})
                continue
            self.calls += raw.calls
            rec = build_record(normalize(raw), self.now().strftime("%Y-%m-%dT%H:%M:%SZ"))
            store.append(self.timelines, rec)
            done.add(number)
            self.stats["mined"] += 1
        manifest = self.write_manifest(started, len(numbers))
        return manifest

    def write_manifest(self, started: str, n_requested: int) -> dict:
        recs = store.load(self.timelines)
        flag_counts: dict[str, int] = {}
        for r in recs:
            for f in r["derived"]["flags"]:
                flag_counts[f] = flag_counts.get(f, 0) + 1
        manifest = {
            "schema": SCHEMA_ID,
            "miner_version": MINER_VERSION,
            "repo": self.repo,
            "holdout": self.repo in HOLDOUT_REPOS,
            "run_started_at": started,
            "run_finished_at": self.now().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "requested": n_requested,
            "records": len(recs),
            "this_run": dict(self.stats, api_calls=self.calls),
            "flag_counts": dict(sorted(flag_counts.items())),
            "timelines_sha256": store.sha256_file(self.timelines) if self.timelines.exists() else None,
            "errors_sha256": store.sha256_file(self.errors) if self.errors.exists() else None,
        }
        store.write_atomic(self.out_dir / "MANIFEST.json", store.dumps(manifest) + "\n")
        return manifest
