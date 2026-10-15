#!/usr/bin/env python3
"""Seal hist-v2-dev-replay/1 bindings for set=dev items. Holdout items are not bound."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

CLASSIFIER_SRC = Path("/workspace/research/paper-v2/benchmark-design/hist-v2-classifier-v8/src")
sys.path.insert(0, str(CLASSIFIER_SRC))
from hist_v2_classify_v8.gitio import diff_path  # noqa: E402

MIRRORS = Path("/tmp/hist-v2-mirrors")
SCHEMA = "hist-v2-dev-replay/1"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def blob(repo: Path, rev: str, path: str) -> bytes | None:
    result = subprocess.run(
        ["git", "-C", str(repo), "cat-file", "-p", f"{rev}:{path}"],
        capture_output=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def set_key(values) -> str:
    return ",".join(str(int(value)) for value in values)


def bind_tree(classified: Path, binding_dir: Path) -> tuple[int, list[str]]:
    binding_dir.mkdir(parents=True, exist_ok=True)
    problems = []
    written = 0
    items_path = classified / "items.jsonl"
    for line in items_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        if item.get("set") != "dev":
            continue
        repo = MIRRORS / f"{item['project']}.git"
        target = item["target_file"]
        answer = item["correct_answer"]
        raw = b"" if not item.get("base") else blob(repo, item["base"], target)
        if raw is None:
            raw = b""
        try:
            base_text = raw.decode("utf-8")
        except UnicodeDecodeError:
            problems.append(f"{item['id']}: base is not utf-8")
            continue
        if sha256_text(base_text) != answer.get("unchanged_base_sha256"):
            problems.append(f"{item['id']}: base sha256 does not match the answer key")
            continue
        patches = []
        failed = False
        for patch in item["patches"]:
            diff = diff_path(str(repo), patch["selected_mb"], patch["selected_head"], target)
            digest = hashlib.sha256(diff).hexdigest()
            if digest != patch.get("code_patch_sha256"):
                problems.append(f"{item['id']}: unified diff sha256 does not match code_patch_sha256 for {patch['pr']}")
                failed = True
                break
            try:
                text = diff.decode("utf-8")
            except UnicodeDecodeError:
                problems.append(f"{item['id']}: diff is not utf-8 for {patch['pr']}")
                failed = True
                break
            if sha256_text(text) != digest:
                problems.append(f"{item['id']}: diff text round-trip mismatch for {patch['pr']}")
                failed = True
                break
            patches.append({"pr": int(patch["pr"]), "unified_diff": text})
        if failed:
            continue
        bodies = {}
        for row in answer.get("allowed") or []:
            key = set_key(row.get("set_key") or row.get("prs"))
            rel = row.get("expected_relpath")
            if not rel:
                problems.append(f"{item['id']}: missing expected bytes for {key}")
                failed = True
                break
            body_bytes = (classified / rel).read_bytes()
            try:
                body = body_bytes.decode("utf-8")
            except UnicodeDecodeError:
                problems.append(f"{item['id']}: R(S) is not utf-8 for {key}")
                failed = True
                break
            if sha256_text(body) != row.get("sha256"):
                problems.append(f"{item['id']}: R(S) sha256 mismatch for {key}")
                failed = True
                break
            bodies[key] = body
        if failed:
            continue
        binding = {
            "schema": SCHEMA,
            "item_id": item["id"],
            "catalog_fixture": False,
            "base_text": base_text,
            "patches": patches,
            "allowed_bodies": bodies,
        }
        name = hashlib.sha256(item["id"].encode("utf-8")).hexdigest() + ".json"
        (binding_dir / name).write_text(
            json.dumps(binding, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        written += 1
    return written, problems


def main() -> int:
    classified_root = Path(sys.argv[1])
    binding_dir = Path(sys.argv[2])
    total = 0
    problems = []
    for classified in sorted(path for path in classified_root.iterdir() if (path / "items.jsonl").is_file()):
        written, found = bind_tree(classified, binding_dir)
        total += written
        problems.extend(found)
        print(f"{classified.name} bindings={written} problems={len(found)}", flush=True)
    report = binding_dir.parent / "binding-problems.txt"
    report.write_text("\n".join(problems) + ("\n" if problems else ""), encoding="utf-8")
    print(f"BINDINGS {total} PROBLEMS {len(problems)}", flush=True)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
