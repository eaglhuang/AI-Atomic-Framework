"""HIST-v2 pair classifier. Draft labels only; not a frozen pre-registration."""

from .classify import decide
from .pipeline import classify_candidates
from .score import (
    bootstrap_interval,
    combined_success,
    delivery_rows,
    equal_weight_pool,
    legal_set_key,
    proposal_final_report,
    reconcile_terminal,
    resample_final_report,
    score_run,
    semantic_status,
    textual_merge_file_on_lock,
    validate_score_instance,
    zero_event_component_bound,
)

__all__ = [
    "bootstrap_interval",
    "classify_candidates",
    "combined_success",
    "decide",
    "delivery_rows",
    "equal_weight_pool",
    "legal_set_key",
    "proposal_final_report",
    "reconcile_terminal",
    "resample_final_report",
    "score_run",
    "semantic_status",
    "textual_merge_file_on_lock",
    "validate_score_instance",
    "zero_event_component_bound",
]
