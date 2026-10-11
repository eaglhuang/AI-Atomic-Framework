"""HIST-v2 pair classifier. Draft labels only; not a frozen pre-registration."""

from .classify import decide
from .pipeline import classify_candidates
from .score import (
    bootstrap_interval,
    delivery_rows,
    equal_weight_pool,
    legal_set_key,
    reconcile_terminal,
    score_run,
    semantic_status,
    textual_merge_file_on_lock,
    zero_event_component_bound,
)

__all__ = [
    "bootstrap_interval",
    "classify_candidates",
    "decide",
    "delivery_rows",
    "equal_weight_pool",
    "legal_set_key",
    "reconcile_terminal",
    "score_run",
    "semantic_status",
    "textual_merge_file_on_lock",
    "zero_event_component_bound",
]
