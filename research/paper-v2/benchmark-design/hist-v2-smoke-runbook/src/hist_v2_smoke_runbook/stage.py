"""Stage gate. Pilot follows the frozen three-arm matrix. Main and held-out stay closed."""

import os


def approval_problem(pins: dict, stage: str) -> str | None:
    if stage != "pilot":
        return None
    spec = pins["pilot"]
    if os.environ.get(spec["approval_env"]) != spec["approval_value"]:
        return "author approval missing; no run directory created"
    return None


def pilot_overlay(pins: dict) -> tuple[dict, list[str]]:
    """Return the pilot pin view, or problems. Does not write a directory."""

    problems = _harness_problems(pins)
    if problems:
        return pins, problems
    spec = pins["pilot"]
    overlay = dict(pins)
    overlay["arms"] = list(spec["arms"])
    overlay["comparison_arms"] = list(spec["comparison_arms"])
    overlay["inter_arrival_ms"] = list(spec["inter_arrival_ms"])
    overlay["orders"] = list(spec["orders"])
    overlay["seeds"] = list(spec["seeds"])
    overlay["per_class_cap"] = int(spec["per_class_cap"])
    overlay["group_cap"] = int(spec["group_cap"])
    overlay["two_proposal_only"] = True
    overlay["trial_banner"] = spec["banner"]
    overlay["generation_kind_line"] = spec["generation_kind_line"]
    overlay["report_scope_line"] = spec["report_scope_line"]
    overlay["arm_mapping"] = spec["arm_mapping"]
    overlay["report_notes"] = list(spec["report_notes"])
    overlay["note_file_lock_contrast"] = True
    overlay["declared_deviations"] = list(spec["declared_deviations"])
    return overlay, []


def _harness_problems(pins: dict) -> list[str]:
    from hist_v2_harness_v2.limits import (
        ARMS,
        COMPARISON_ARMS,
        DEADLINE_SECONDS,
        INTER_ARRIVAL_MS,
        MAX_RETRIES_AFTER_FIRST_SUBMIT,
        ORDERS,
        SEEDS,
    )

    spec = pins["pilot"]
    problems: list[str] = []
    if tuple(spec["arms"]) != COMPARISON_ARMS:
        problems.append(
            "pilot arms "
            + ",".join(spec["arms"])
            + " != harness comparison arms "
            + ",".join(COMPARISON_ARMS)
        )
    if "atm" in spec["arms"]:
        problems.append("pilot arms include atm; the frozen prereg comparison does not")
    if tuple(spec["comparison_arms"]) != tuple(spec["arms"]):
        problems.append("pilot comparison_arms must equal the three frozen arms")
    if tuple(spec["inter_arrival_ms"]) != INTER_ARRIVAL_MS:
        problems.append("pilot intervals do not match the sealed harness sweep")
    if tuple(spec["orders"]) != ORDERS:
        problems.append("pilot orders do not match the sealed harness")
    if tuple(spec["seeds"]) != SEEDS:
        problems.append("pilot seeds do not match the sealed harness")
    if DEADLINE_SECONDS != 30 or MAX_RETRIES_AFTER_FIRST_SUBMIT != 8:
        problems.append(
            f"sealed harness deadline {DEADLINE_SECONDS}s retries {MAX_RETRIES_AFTER_FIRST_SUBMIT} != prereg 30s and 8"
        )
    if tuple(ARMS) != ("atm", "textual_merge_file", "steward", "file_lock"):
        problems.append("sealed harness arm tuple changed")
    return problems
