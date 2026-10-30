"""Shared item clock (prereg v2.0 §3.2 L96-98; v2.1 A8).

When any proposal's 30 s expires, every writer of the item stops at
T_stop = earliest first submit + 30 s. Each writer publishes its first
submit (monotonic seconds) as one file in ``<workspace>/item-clock/`` and
re-reads the directory at every stop check, so a writer that arrives late
inherits the earlier writer's T_stop instead of a fresh 30 s.
"""

import os
from pathlib import Path

from .limits import DEADLINE_SECONDS


def item_stop_from_first_submits(first_submits) -> float:
    values = [float(value) for value in first_submits]
    if not values:
        raise ValueError("no first submit recorded")
    return min(values) + DEADLINE_SECONDS


class ItemClock:
    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)

    def publish(self, proposal_id, first_submit: float) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        final = self.directory / f"submit-{proposal_id}"
        temporary = self.directory / f".submit-{proposal_id}.tmp-{os.getpid()}"
        temporary.write_text(repr(float(first_submit)) + "\n", encoding="utf-8")
        os.replace(temporary, final)

    def published(self) -> dict[str, float]:
        out: dict[str, float] = {}
        if not self.directory.exists():
            return out
        for path in self.directory.glob("submit-*"):
            text = path.read_text(encoding="utf-8").strip()
            if text:
                out[path.name[len("submit-"):]] = float(text)
        return out

    def item_stop(self, own_first_submit: float) -> float:
        return item_stop_from_first_submits([own_first_submit, *self.published().values()])


class LiveItemStop:
    """A T_stop that is re-read from the shared directory whenever it is used
    as a number, so every stop check sees the earliest published submit."""

    def __init__(self, item_clock: ItemClock, own_first_submit: float) -> None:
        self.item_clock = item_clock
        self.own_first_submit = float(own_first_submit)
        self.last = item_stop_from_first_submits([own_first_submit])

    def __float__(self) -> float:
        self.last = self.item_clock.item_stop(self.own_first_submit)
        return self.last


def open_item_stop(workspace: Path, proposal_id, first_submit: float, item_clock: ItemClock | None = None) -> LiveItemStop:
    clock_dir = item_clock or ItemClock(Path(workspace) / "item-clock")
    clock_dir.publish(proposal_id, first_submit)
    return LiveItemStop(clock_dir, first_submit)


def clocks_record(stamps: list, budget, item_stop) -> dict:
    stop = float(item_stop)
    return {
        "clock": "monotonic",
        "stamps": list(stamps),
        "own_deadline": None if budget.first_submit is None else budget.first_submit + DEADLINE_SECONDS,
        "item_stop": stop,
        "effective_stop": None if budget.first_submit is None else budget.effective_stop(stop),
    }
