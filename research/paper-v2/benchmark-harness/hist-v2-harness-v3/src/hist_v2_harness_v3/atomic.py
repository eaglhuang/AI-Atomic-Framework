"""One atomic replace: temp file, one fsync, rename. No second fsync-as-attempt."""

import os
from pathlib import Path

from .clock import Clock


def atomic_replace(path: Path, data: bytes, clock: Clock, effective_stop: float) -> float | None:
    """Rename onto path, or return None without renaming when the clock has stopped.

    A temp file written after the stop is removed and is not renamed.
    """
    if clock.now() > effective_stop:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    token = f"{os.getpid()}-{clock.now():.6f}".replace(".", "-")
    temporary = path.with_name(f".{path.name}.tmp-harness-{token}")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    if clock.now() > effective_stop:
        temporary.unlink(missing_ok=True)
        return None
    os.replace(temporary, path)
    renamed_at = clock.now()
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return renamed_at
