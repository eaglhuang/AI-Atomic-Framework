"""Frozen HIST-v2 method limits.

Source directory (read-only, not imported as a mutable config):
research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/
R2-D2, R2-D4, R3-D1, R4-D2. The numbers below are the harness copy of that
freeze. A unit test checks they still match the classifier v8 constants.
"""

DEADLINE_SECONDS = 30
MAX_RETRIES_AFTER_FIRST_SUBMIT = 8
MAX_ATTEMPTS = 9
INTER_ARRIVAL_MS = (0, 50, 100, 500, 2000)
SEEDS = (0, 1)
ORDERS = ("forward", "reverse")
ARMS = ("atm", "textual_merge_file", "steward", "file_lock")
# Prereg main cell. The issue adds the atm arm beside these three.
COMPARISON_ARMS = ("steward", "file_lock", "textual_merge_file")
# Core contract: a positive window is required for two writers to share a batch.
# Zero seals a proposal alone. This is the admission window, not a result.
ATM_COMPOSE_WINDOW_MS = 2000
ATM_MAX_BATCH_SIZE = 8
