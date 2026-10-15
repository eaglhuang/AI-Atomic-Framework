#!/usr/bin/env python3
"""Build hist-v2-dev-replay/2 bindings for the sealed pilot's 29 dev items.

Reads classifier v8 items and the sealed v1 bindings. Fetches parent_text and
head_text from the public GitHub blob for selected_mb and selected_head.
Does not write into the v1 directory.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CLASSIFIED = REPO_ROOT / "research/paper-v2/benchmark-main/2026-10-15-hist-v2-classify-v8"
V1_BINDINGS = CLASSIFIED / "dev-replay-bindings"
PILOT_OBS = REPO_ROOT / "research/paper-v2/benchmark-trials/2026-10-15-hist-v2-pilot/observations.jsonl"
OUT_DIR = Path(__file__).resolve().parent
SCHEMA = "hist-v2-dev-replay/2"
GITHUB = {
    "django": "django/django",
    "sphinx": "sphinx-doc/sphinx",
    "sympy": "sympy/sympy",
}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def pilot_item_ids() -> list[str]:
    seen: list[str] = []
    known = set()
    for line in PILOT_OBS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        item_id = json.loads(line)["item_id"]
        if item_id not in known:
            known.add(item_id)
            seen.append(item_id)
    return seen


def load_items(wanted: set[str]) -> dict[str, dict]:
    found = {}
    for line in (CLASSIFIED / "items.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("id") in wanted:
            found[row["id"]] = row
    return found


def binding_name(item_id: str) -> str:
    return hashlib.sha256(item_id.encode("utf-8")).hexdigest() + ".json"


def fetch_text(slug: str, rev: str, path: str) -> str:
    url = f"https://raw.githubusercontent.com/{slug}/{rev}/{path}"
    request = urllib.request.Request(url, headers={"User-Agent": "hist-v2-dev-replay-v2"})
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
            break
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (429, 500, 502, 503):
                raise
            time.sleep(2 ** attempt)
        except urllib.error.URLError as exc:
            last = exc
            time.sleep(2 ** attempt)
    else:
        raise RuntimeError(f"fetch failed {url}: {last}")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError(f"{url} is not utf-8") from exc


def build() -> int:
    ids = pilot_item_ids()
    if len(ids) != 29:
        print(f"expected 29 pilot items, found {len(ids)}", file=sys.stderr)
        return 2
    items = load_items(set(ids))
    missing = [item_id for item_id in ids if item_id not in items]
    if missing:
        print(f"items missing: {missing}", file=sys.stderr)
        return 2
    out = OUT_DIR / "bindings"
    if any(out.glob("*.json")):
        print(f"refusing to overwrite {out}", file=sys.stderr)
        return 6
    out.mkdir(parents=True)
    cache: dict[tuple[str, str, str], str] = {}
    for item_id in ids:
        item = items[item_id]
        project = item["project"]
        slug = GITHUB.get(project)
        if slug is None:
            print(f"no github slug for {project}", file=sys.stderr)
            return 2
        v1_path = V1_BINDINGS / binding_name(item_id)
        v1 = json.loads(v1_path.read_text(encoding="utf-8"))
        if v1.get("schema") != "hist-v2-dev-replay/1":
            print(f"{item_id}: v1 schema", file=sys.stderr)
            return 2
        by_pr = {int(row["pr"]): row for row in v1["patches"]}
        patches = []
        for patch in item["patches"]:
            pr = int(patch["pr"])
            bound = by_pr[pr]
            diff = bound["unified_diff"]
            if sha256_text(diff) != patch["code_patch_sha256"]:
                print(f"{item_id}: v1 diff hash mismatch for {pr}", file=sys.stderr)
                return 2
            target = item["target_file"]
            endpoints = {}
            for label, rev in (("parent_text", patch["selected_mb"]), ("head_text", patch["selected_head"])):
                key = (slug, rev, target)
                if key not in cache:
                    cache[key] = fetch_text(slug, rev, target)
                    print(f"fetched {slug} {rev[:12]} {target}", flush=True)
                endpoints[label] = cache[key]
            patches.append(
                {
                    "head_text": endpoints["head_text"],
                    "parent_text": endpoints["parent_text"],
                    "pr": pr,
                    "selected_head": patch["selected_head"],
                    "selected_mb": patch["selected_mb"],
                    "unified_diff": diff,
                }
            )
        binding = {
            "allowed_bodies": v1["allowed_bodies"],
            "base_text": v1["base_text"],
            "catalog_fixture": False,
            "item_id": item_id,
            "patches": patches,
            "schema": SCHEMA,
        }
        text = json.dumps(binding, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
        (out / binding_name(item_id)).write_text(text, encoding="utf-8")
        print(f"wrote {item_id}", flush=True)
    (OUT_DIR / "ITEM_IDS.txt").write_text("".join(f"{item_id}\n" for item_id in ids), encoding="utf-8")
    print(f"BINDINGS {len(ids)} FETCHES {len(cache)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(build())
