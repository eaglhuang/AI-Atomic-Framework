"""Minimal stdlib validator mirroring schema/timeline.schema.json (no jsonschema dep)."""

from __future__ import annotations

import re

from . import SCHEMA_ID
from .derive import EXCLUDING_REASONS, parse_ts

TS = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
SHA = re.compile(r"^[0-9a-f]{40}$")
REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def errors(rec: dict) -> list[str]:
    e: list[str] = []

    def need(cond: bool, msg: str) -> None:
        if not cond:
            e.append(msg)

    need(rec.get("schema") == SCHEMA_ID, "schema id")
    raw = rec.get("raw") or {}
    der = rec.get("derived") or {}
    need(bool(REPO.match(str(raw.get("repo", "")))), "raw.repo")
    need(isinstance(raw.get("number"), int) and raw["number"] > 0, "raw.number")
    need(bool(TS.match(str(raw.get("created_at", "")))), "raw.created_at")
    commits = raw.get("commits")
    need(isinstance(commits, list), "raw.commits list")
    for c in commits or []:
        need(bool(SHA.match(str(c.get("sha", "")))), f"commit sha {c.get('index')}")
        need(bool(TS.match(str(c.get("author_date", "")))), f"author_date {c.get('index')}")
        need(bool(TS.match(str(c.get("committer_date", "")))), f"committer_date {c.get('index')}")
        if c.get("is_merge"):
            need(c.get("files") is None, f"merge commit files must be null {c.get('index')}")
        else:
            need(isinstance(c.get("files"), list), f"files list {c.get('index')}")
    need(isinstance(raw.get("pull_files"), list), "raw.pull_files")
    for k in ("t_start", "t_start_min_author", "t_submit_alt"):
        v = der.get(k)
        need(v is None or bool(TS.match(v)), f"derived.{k}")
    need(der.get("t_submit") == raw.get("created_at"), "derived.t_submit == created_at")
    for k in ("s1_files", "s2_files", "s3_dirs", "flags", "line_timeline"):
        need(isinstance(der.get(k), list), f"derived.{k}")
    need(isinstance(der.get("t_write"), dict), "derived.t_write")
    if der.get("t_start") and isinstance(der.get("t_write"), dict):
        for f in der.get("s1_files") or []:
            need(der["t_write"].get(f) == der["t_start"], f"t_write[{f}] == t_start for S1")
    # exclusion rule A (miner_version >= 2 records carry these fields)
    if "timeline_ok" in der:
        reasons = der.get("exclusion_reasons")
        need(isinstance(reasons, list) and all(r in EXCLUDING_REASONS for r in reasons), "derived.exclusion_reasons")
        need(der["timeline_ok"] is (not reasons), "timeline_ok iff no exclusion_reasons")
        if der["timeline_ok"]:
            need(der.get("t_start_imputed") is None, "t_start_imputed null when timeline_ok")
            need(der.get("t_start_sens") == der.get("t_start"), "t_start_sens == t_start when timeline_ok")
            need(isinstance(der.get("dev_seconds"), int) and der["dev_seconds"] >= 0, "dev_seconds >= 0 when timeline_ok")
        else:
            imp = der.get("t_start_imputed")
            need(imp is None or bool(TS.match(imp)), "derived.t_start_imputed")
            need(der.get("t_start_sens") == imp, "t_start_sens == t_start_imputed when excluded")
            if imp and TS.match(imp) and TS.match(str(raw.get("created_at", ""))):
                need(parse_ts(imp) <= parse_ts(raw["created_at"]), "t_start_imputed <= created_at")
    return e
