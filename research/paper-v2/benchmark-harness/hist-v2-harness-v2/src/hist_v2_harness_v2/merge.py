"""git merge-file without --union, --ours, or --theirs.

Conflict stdout is discarded and is never written to the target.
"""

import subprocess
import tempfile
from pathlib import Path


def git_merge_file(current: str, base: str, theirs: str) -> tuple[int, str]:
    with tempfile.TemporaryDirectory(prefix="hist-v2-merge-") as temp:
        root = Path(temp)
        current_path = root / "current"
        base_path = root / "base"
        theirs_path = root / "theirs"
        current_path.write_bytes(current.encode("utf-8"))
        base_path.write_bytes(base.encode("utf-8"))
        theirs_path.write_bytes(theirs.encode("utf-8"))
        result = subprocess.run(
            ["git", "merge-file", "-p", str(current_path), str(base_path), str(theirs_path)],
            capture_output=True,
            check=False,
        )
    if result.returncode < 0 or result.returncode >= 128:
        detail = result.stderr.decode("utf-8", "replace")[:400]
        raise RuntimeError(f"git merge-file failed: {detail}")
    # A conflict still prints a merge with markers. Callers must not write that.
    text = result.stdout.decode("utf-8")
    if result.returncode != 0:
        return result.returncode, ""
    return 0, text
