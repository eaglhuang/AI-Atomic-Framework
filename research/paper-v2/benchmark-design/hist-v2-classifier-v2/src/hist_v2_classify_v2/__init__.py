"""HIST-v2 pair classifier. Draft labels only; not a frozen pre-registration."""

from .classify import decide
from .pipeline import classify_candidates

__all__ = ["classify_candidates", "decide"]
