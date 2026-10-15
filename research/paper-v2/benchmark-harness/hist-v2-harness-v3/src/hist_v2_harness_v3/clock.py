"""Injectable clock. Deadline tests advance this instead of sleeping 30s."""

import time


class Clock:
    def now(self) -> float:
        raise NotImplementedError


class WallClock(Clock):
    def now(self) -> float:
        return time.time()


class ManualClock(Clock):
    def __init__(self, start: float = 0.0) -> None:
        self.t = float(start)

    def now(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += float(seconds)
