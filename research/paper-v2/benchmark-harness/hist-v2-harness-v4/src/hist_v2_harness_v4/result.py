"""Writer result shared by every arm."""

from dataclasses import dataclass, field


@dataclass
class WriterResult:
    proposal_id: int
    arm: str
    arm_terminal: str
    stop_reason: str
    accepted: bool
    retries: int
    attempts: int
    first_submit: float
    executable_seconds: float
    rename_at: float | None
    ack_at: float | None
    batch_size: int | None = None
    batch_id: str | None = None
    accepted_ids: list[int] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    events: list = field(default_factory=list)
    detail: str | None = None
    # v4: dual-clock stamps and the item T_stop this writer last saw (monotonic s).
    clocks: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "proposal_id": self.proposal_id,
            "arm": self.arm,
            "arm_terminal": self.arm_terminal,
            "stop_reason": self.stop_reason,
            "accepted": self.accepted,
            "retries": self.retries,
            "attempts": self.attempts,
            "first_submit": self.first_submit,
            "executable_seconds": self.executable_seconds,
            "rename_at": self.rename_at,
            "ack_at": self.ack_at,
            "batch_size": self.batch_size,
            "batch_id": self.batch_id,
            "accepted_ids": self.accepted_ids,
            "metrics": self.metrics,
            "events": self.events,
            "detail": self.detail,
            "clocks": self.clocks,
        }
