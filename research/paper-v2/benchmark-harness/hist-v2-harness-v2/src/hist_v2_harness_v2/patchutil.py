"""Unified diffs for fixtures, applied by the ATM core patch function."""

import json
import subprocess
import tempfile
from pathlib import Path

from .paths import node_dir, repo_root


class PatchApplyError(RuntimeError):
    pass


def patch_replace_line(filename: str, base: str, index: int, new: str) -> str:
    lines = base.splitlines()
    if index < 0 or index >= len(lines):
        raise PatchApplyError(f"line index {index} is outside {filename}")
    start = max(0, index - 1)
    end = min(len(lines), index + 2)
    body = []
    for cursor in range(start, end):
        if cursor == index:
            body.append(f"-{lines[cursor]}")
            body.append(f"+{new}")
        else:
            body.append(f" {lines[cursor]}")
    count = end - start
    header = f"@@ -{start + 1},{count} +{start + 1},{count} @@"
    return "\n".join([f"--- a/{filename}", f"+++ b/{filename}", header, *body, ""])


def patch_create(filename: str, text: str) -> str:
    line = text[:-1] if text.endswith("\n") else text
    return "\n".join(
        [
            f"--- a/{filename}",
            f"+++ b/{filename}",
            "@@ -0,0 +1,1 @@",
            f"+{line}",
            "",
        ]
    )


def patch_delete(filename: str, base: str) -> str:
    lines = base.splitlines()
    if len(lines) != 1:
        raise PatchApplyError("delete fixtures use a single line")
    return "\n".join(
        [
            f"--- a/{filename}",
            f"+++ b/{filename}",
            "@@ -1,1 +0,0 @@",
            f"-{lines[0]}",
            "",
        ]
    )


def apply_unified_patch(base: str, patch: str) -> str:
    """Apply with the core unified-patch module so arms share one applier."""
    if patch == "":
        return base
    payload = {"base": base, "patch": patch}
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
        json.dump(payload, handle)
        job_path = handle.name
    version = subprocess.check_output(["node", "-p", "process.versions.node"], text=True).strip()
    flag = "--strip-types" if int(version.split(".")[0]) >= 24 else "--experimental-strip-types"
    script = node_dir() / "apply-patch.ts"
    result = subprocess.run(
        ["node", flag, str(script), job_path],
        cwd=repo_root(),
        capture_output=True,
        text=True,
        check=False,
    )
    Path(job_path).unlink(missing_ok=True)
    if not result.stdout:
        raise PatchApplyError(result.stderr.strip() or "apply-patch produced no output")
    parsed = json.loads(result.stdout)
    if not parsed.get("ok"):
        raise PatchApplyError(parsed.get("detail") or "patch did not apply")
    return parsed["text"]
