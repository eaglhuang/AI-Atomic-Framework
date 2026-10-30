"""Per-proposal deadline. Attempt 0 is the first submit. Eight retries follow.

The 30 second budget starts at the first submit and does not reset.
v4 (prereg v2.1 A8): the effective stop is computed by the classifier v8
scorer function itself (``reconcile_terminal``), so arm and scorer share
one definition: min(own first submit + 30 s, item T_stop).
"""

from hist_v2_classify_v8.score import reconcile_terminal

from .limits import MAX_RETRIES_AFTER_FIRST_SUBMIT


def _scorer_stop(first_submit: float, item_stop: float) -> dict:
    return reconcile_terminal(
        {
            "send_time": float(first_submit),
            "first_submit_time": float(first_submit),
            "item_stop_time": float(item_stop),
            "entry_points_stopped": True,
            "live_entry_points": [],
            "rename_time": None,
            "ack_time": None,
        }
    )


def effective_stop(first_submit: float, item_stop: float) -> float:
    return float(_scorer_stop(first_submit, item_stop)["effective_stop"])


def timeout_reason(first_submit: float, item_stop: float) -> str:
    """'item-stop' when another writer's T_stop ends this proposal first."""
    return str(_scorer_stop(first_submit, item_stop)["stop_reason"])


class AttemptBudget:
    def __init__(self) -> None:
        self.first_submit: float | None = None
        self.retries = 0
        self.attempts = 0

    def open_first(self, now: float) -> None:
        if self.first_submit is None:
            self.first_submit = float(now)
            self.attempts = 1

    def effective_stop(self, item_stop: float) -> float:
        if self.first_submit is None:
            raise RuntimeError("first submit has not been recorded")
        return effective_stop(self.first_submit, item_stop)

    def executable_seconds(self, item_stop: float) -> float:
        if self.first_submit is None:
            raise RuntimeError("first submit has not been recorded")
        return max(0.0, self.effective_stop(item_stop) - self.first_submit)

    def expired(self, now: float, item_stop: float) -> bool:
        return float(now) >= self.effective_stop(item_stop)

    def consume_retry(self, now: float, item_stop: float) -> bool:
        """Record one retry after the first submit. The ninth retry is refused."""
        if self.first_submit is None:
            raise RuntimeError("first submit has not been recorded")
        if self.retries >= MAX_RETRIES_AFTER_FIRST_SUBMIT:
            return False
        if self.expired(now, item_stop):
            return False
        self.retries += 1
        self.attempts += 1
        return True

    def note_retries(self, count: int) -> None:
        if count < 0 or count > MAX_RETRIES_AFTER_FIRST_SUBMIT:
            raise ValueError("retry count is outside the frozen budget")
        self.retries = count
        self.attempts = 1 + count
