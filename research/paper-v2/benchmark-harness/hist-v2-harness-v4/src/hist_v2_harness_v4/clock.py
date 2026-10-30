"""Injectable clocks for harness v4 (prereg v2.1 A8).

All deadline arithmetic uses ``now()``, which is CLOCK_MONOTONIC seconds on
the real clock. CLOCK_MONOTONIC is system-wide on Linux, so stamps taken by
different writer processes on one boot are comparable. ``wall()`` is
``time.time()`` and is only a logged label. ``stamp()`` records both so the
A9 validity rule can detect a realtime step that monotonic did not see.
"""

import time


class Clock:
    def now(self) -> float:
        raise NotImplementedError

    def wall(self) -> float:
        raise NotImplementedError

    def stamp(self, event: str) -> dict:
        return {"event": event, "mono": self.now(), "wall": self.wall()}


class MonotonicClock(Clock):
    """Real clock. ``wall_jump_s`` is a test hook: it is added to wall() only
    after ``arm_jump()`` was called, to simulate a realtime step (NTP/VM
    resync) that leaves CLOCK_MONOTONIC unchanged. It is 0 in every run."""

    def __init__(self, wall_jump_s: float = 0.0) -> None:
        self.wall_jump_s = float(wall_jump_s)
        self._jumped = False

    def arm_jump(self) -> None:
        self._jumped = True

    def now(self) -> float:
        return time.monotonic()

    def wall(self) -> float:
        return time.time() + (self.wall_jump_s if self._jumped else 0.0)


# v3 name kept for callers that only need a label. Deadlines must not use it.
class WallClock(Clock):
    def now(self) -> float:
        return time.time()

    def wall(self) -> float:
        return time.time()


class ManualClock(Clock):
    """Test clock. ``advance`` moves both clocks; ``jump_wall`` moves only
    the realtime label, like a host clock step."""

    def __init__(self, start: float = 0.0, wall_start: float | None = None) -> None:
        self.t = float(start)
        self.w = float(start if wall_start is None else wall_start)

    def now(self) -> float:
        return self.t

    def wall(self) -> float:
        return self.w

    def advance(self, seconds: float) -> None:
        self.t += float(seconds)
        self.w += float(seconds)

    def jump_wall(self, seconds: float) -> None:
        self.w += float(seconds)
