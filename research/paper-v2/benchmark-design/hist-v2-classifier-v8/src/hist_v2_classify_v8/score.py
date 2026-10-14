"""Score an ATM run against a classifier answer. Does not regenerate the answer.

Safety uses the accepted set S and the reference bytes R(S).
Progress asks only whether that legal S is maximal.
Functional delivery and semantic retention are separate rows.
"""

from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from jsonschema.validators import extend

# D8 / R2-D2: retries after the first submit. A 9th retry is not available.
MAX_RETRIES_AFTER_FIRST_SUBMIT = 8
DEADLINE_SECONDS = 30

# R5-D1. The observed point estimate is a function of the original sample.
# A resample with a zero denominator does not erase it, and it is not used
# to recompute a percentile on the replicates that still have a denominator.
RESAMPLE_ZERO_POLICY = "point-reported-interval-undefined"

# Bytes may match without being throughput. A safe full reject is not in this set.
_BYTES_OK_REASONS = frozenset(
    {
        "legal-and-matches-R(S)",
        "legal-bytes-without-timely-ack",
    }
)
_THROUGHPUT_REASONS = frozenset({"legal-and-matches-R(S)"})

_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema" / "score-input.schema.json"
_ENTRY_VALIDATORS = {}
_SCHEMA_DOCUMENT = None


def legal_set_key(prs) -> tuple[int, ...]:
    """Canonical legal-set key: sorted unique proposal ids. Order is not part of the key.

    When bytes depend on order, that permutation is stored separately as ``order``
    and is not used to look up a legal subset.
    """
    return tuple(sorted({int(pr) for pr in prs}))


def score_run(answer: dict, run: dict) -> dict:
    """Consume one arm result.

    The legal-set key is ``legal_set_key`` on both the answer row and ``accepted_prs``.
    ``[3, 1]`` and ``[1, 3]`` are the same subset.
    """
    validate_acceptance_input(run)
    accepted = legal_set_key(run.get("accepted_prs") or [])
    observed = run.get("observed_sha256")
    acked = bool(run.get("acked"))

    def finish(accepted_key, **fields):
        payload = {"acked": acked}
        if "proposal_id" in run:
            payload["proposal_id"] = run["proposal_id"]
        return _verdict(accepted_key, **payload, **fields)
    allowed = {}
    for row in answer.get("allowed") or []:
        allowed[legal_set_key(row.get("set_key", row["prs"]))] = row
    base_sha = answer.get("unchanged_base_sha256")

    if accepted in allowed:
        row = allowed[accepted]
        if observed != row["sha256"]:
            return finish(
                accepted,
                safety="fail",
                safety_reason="bytes-do-not-match-R(S)",
                progress="not-applicable",
                progress_reason="illegal-bytes",
                legal=True,
                maximal=bool(row["maximal"]),
                reference_sha256=row["sha256"],
            )
        if not acked:
            return finish(
                accepted,
                safety="reconcile",
                safety_reason="legal-bytes-without-timely-ack",
                progress="not-applicable",
                progress_reason="not-an-in-deadline-accept",
                legal=True,
                maximal=bool(row["maximal"]),
                reference_sha256=row["sha256"],
            )
        if row["maximal"]:
            progress, progress_reason = "maximal", "maximal-legal-subset"
        else:
            progress, progress_reason = "shortfall", "legal-non-maximal"
        return finish(
            accepted,
            safety="pass",
            safety_reason="legal-and-matches-R(S)",
            progress=progress,
            progress_reason=progress_reason,
            legal=True,
            maximal=bool(row["maximal"]),
            reference_sha256=row["sha256"],
        )

    if accepted == ():
        base_ok = base_sha is not None and observed == base_sha
        if acked:
            return finish(
                accepted,
                safety="fail",
                safety_reason="false-ack",
                progress="not-applicable",
                progress_reason="acked-without-a-legal-write",
                legal=False,
                maximal=None,
                reference_sha256=base_sha,
            )
        if not base_ok:
            return finish(
                accepted,
                safety="fail",
                safety_reason="unauthorized-bytes",
                progress="not-applicable",
                progress_reason="reject-did-not-leave-base",
                legal=False,
                maximal=None,
                reference_sha256=base_sha,
            )
        if answer.get("full_reject_allowed"):
            return finish(
                accepted,
                safety="pass",
                safety_reason="full-reject-only-legal-outcome",
                progress="maximal",
                progress_reason="no-legal-subset",
                legal=True,
                maximal=True,
                reference_sha256=base_sha,
            )
        return finish(
            accepted,
            safety="pass",
            safety_reason="no-false-accept",
            progress="shortfall",
            progress_reason="unnecessary-reject",
            legal=True,
            maximal=False,
            reference_sha256=base_sha,
        )

    return finish(
        accepted,
        safety="fail",
        safety_reason="illegal-set",
        progress="not-applicable",
        progress_reason="accepted-set-not-legal",
        legal=False,
        maximal=None,
        reference_sha256=None,
    )


def delivery_rows(proposals: list[dict], accepted_evaluations: list[dict]) -> list[dict]:
    """Separate functional delivery from semantic retention of the accepted set.

    A legally rejected proposal stays in the functional denominator and is not
    delivered (progress cost). It is not part of the semantic-retention denominator.
    Missing tests and zero denominators are their own rows.
    """
    evaluable = [row for row in proposals if row.get("has_tests")]
    not_evaluable = [row for row in proposals if not row.get("has_tests")]
    legal_rejects = [row for row in proposals if row.get("legally_rejected")]
    rows: list[dict] = []
    if evaluable:
        numerator = sum(1 for row in evaluable if row.get("delivered"))
        rows.append(
            {
                "row": "functional-delivery-rate",
                "numerator": numerator,
                "denominator": len(evaluable),
                "rate": numerator / len(evaluable),
                "population": "submitted-proposals-with-solo-reference-tests",
            }
        )
    else:
        rows.append(
            {
                "row": "zero-denominator",
                "metric": "functional-delivery-rate",
                "denominator": 0,
            }
        )
    rows.append({"row": "legal-rejects", "count": len(legal_rejects)})
    rows.append({"row": "not-evaluable", "count": len(not_evaluable), "reason": "no-tests"})

    semantic = []
    semantic_blind = []
    semantic_rejects = []
    for row in accepted_evaluations:
        kind = semantic_status(row)
        if kind == "legal-reject":
            semantic_rejects.append(row)
        elif kind == "not-evaluable":
            semantic_blind.append(row)
        else:
            semantic.append(row)
    if semantic:
        numerator = sum(int(row["retained_pass_count"]) for row in semantic)
        denominator = sum(int(row["reference_pass_count"]) for row in semantic)
        if denominator == 0:
            rows.append(
                {
                    "row": "zero-denominator",
                    "metric": "semantic-retention-of-accepted-changes",
                    "denominator": 0,
                }
            )
        else:
            rows.append(
                {
                    "row": "semantic-retention-of-accepted-changes",
                    "numerator": numerator,
                    "denominator": denominator,
                    "rate": numerator / denominator,
                    "reference": "R(S)",
                }
            )
    else:
        rows.append(
            {
                "row": "zero-denominator",
                "metric": "semantic-retention-of-accepted-changes",
                "denominator": 0,
            }
        )
    rows.append(
        {
            "row": "semantic-not-evaluable",
            "count": len(semantic_blind),
            "reason": "no-passing-tests-on-R(S)",
        }
    )
    rows.append({"row": "semantic-legal-rejects-excluded", "count": len(semantic_rejects)})
    return rows


def zero_event_component_bound(n_components: int, alpha: float = 0.05) -> dict:
    """One-sided Clopper–Pearson upper bound when every component event count is 0.

    The bootstrap percentile interval degenerates in that case. ``n_components`` is
    the count of shared-PR connected components, not seeds, orders, or intervals.
    The bound is not a proposal failure rate.
    """
    if n_components <= 0:
        raise ValueError("component count must be positive; zero components is a zero denominator, not a rate")
    if not 0 < alpha < 1:
        raise ValueError("alpha must be between 0 and 1")
    upper = 1.0 - alpha ** (1.0 / n_components)
    return {
        "unit": "shared-pr-connected-component",
        "alpha": alpha,
        "method": "clopper-pearson-one-sided",
        "n_components": n_components,
        "events": 0,
        "upper": upper,
        "rule_of_three_approximation": 3.0 / n_components,
        "bootstrap_degenerate_when_all_observations_are_zero": True,
        "not_a_proposal_failure_rate": True,
    }


class ScoreInputError(ValueError):
    """A score-input instance failed schema validation. ``messages`` keeps every error."""

    def __init__(self, messages: list[str]):
        self.messages = list(messages)
        super().__init__("; ".join(self.messages))


_COUNT_FIELDS = ("reference_pass_count", "retained_pass_count")


def _is_python_int(value) -> bool:
    """True only for a real int. Bool and integral floats such as 1.0 are rejected."""
    return type(value) is int


def _python_int_count_errors(instance: dict) -> list[str]:
    errors = []
    for field in _COUNT_FIELDS:
        if field not in instance:
            continue
        value = instance[field]
        if not _is_python_int(value):
            errors.append(f"{field} must be a Python int; got {type(value).__name__}")
    return errors


def _hist_v2_bounds(validator, enabled, instance, schema):
    """Cross-field bounds. Runs even when other keywords on the same schema also fail."""
    del validator, schema
    if not enabled or not isinstance(instance, dict):
        return
    for message in _python_int_count_errors(instance):
        yield ValidationError(message)
    passing = instance.get("passing_test_ids")
    retained_ids = instance.get("retained_test_ids")
    reference = instance.get("reference_pass_count")
    retained = instance.get("retained_pass_count")
    reference_is_int = _is_python_int(reference)
    retained_is_int = _is_python_int(retained)
    if isinstance(passing, list) and reference_is_int and reference != len(passing):
        yield ValidationError("reference_pass_count must equal the number of passing_test_ids")
    if isinstance(retained_ids, list) and retained_is_int and retained != len(retained_ids):
        yield ValidationError("retained_pass_count must equal the number of retained_test_ids")
    if reference_is_int and retained_is_int and retained > reference:
        yield ValidationError("retained_pass_count exceeds reference_pass_count")
    if isinstance(passing, list) and isinstance(retained_ids, list):
        passing_ids = set(passing)
        if any(item not in passing_ids for item in retained_ids):
            yield ValidationError("retained_test_ids is not a subset of passing_test_ids")


def _flatten_errors(error) -> list[str]:
    messages = [error.message]
    for child in getattr(error, "context", None) or []:
        messages.extend(_flatten_errors(child))
    return messages


def _schema_document() -> dict:
    global _SCHEMA_DOCUMENT
    if _SCHEMA_DOCUMENT is None:
        document = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
        encoded = json.dumps(document)
        if "oneOf" in encoded or "anyOf" in encoded:
            raise ScoreInputError(["score-input schema must not combine kinds with oneOf or anyOf"])
        _SCHEMA_DOCUMENT = document
    return _SCHEMA_DOCUMENT


def _entry_validator(entry_name: str):
    if entry_name not in _ENTRY_VALIDATORS:
        document = _schema_document()
        entry = document["$defs"][entry_name]
        schema = {"$schema": document["$schema"], "$defs": document["$defs"], **entry}
        extended = extend(Draft202012Validator, validators={"histV2Bounds": _hist_v2_bounds})
        _ENTRY_VALIDATORS[entry_name] = extended(schema)
    return _ENTRY_VALIDATORS[entry_name]


def _validate_entry(instance: dict, entry_name: str) -> dict:
    if not isinstance(instance, dict):
        raise ScoreInputError(["score input must be an object"])
    errors = []
    for error in _entry_validator(entry_name).iter_errors(instance):
        errors.extend(_flatten_errors(error))
    if entry_name == "semanticEntry":
        errors.extend(_python_int_count_errors(instance))
    if errors:
        deduped = []
        for message in errors:
            if message not in deduped:
                deduped.append(message)
        raise ScoreInputError(deduped)
    return instance


def validate_acceptance_input(run: dict) -> dict:
    """Acceptance entry. Does not accept a semantic-evaluation object."""
    return _validate_entry(run, "acceptanceEntry")


def validate_semantic_input(row: dict) -> dict:
    """Semantic-evaluation entry. Does not accept an acceptance object.

    ``passing_test_ids`` are the tests that pass on R(S).
    """
    return _validate_entry(row, "semanticEntry")


def validate_score_instance(instance: dict) -> dict:
    """Dispatch on ``kind`` to exactly one entry. A missing or foreign kind is rejected.

    This function does not try the other kind when the selected entry fails.
    """
    if not isinstance(instance, dict):
        raise ScoreInputError(["score input must be an object"])
    kind = instance.get("kind")
    if kind == "acceptance":
        return validate_acceptance_input(instance)
    if kind == "semantic-evaluation":
        return validate_semantic_input(instance)
    raise ScoreInputError(["kind must be acceptance or semantic-evaluation"])


def semantic_status(row: dict) -> str:
    """Map one accepted set to evaluable, not-evaluable, or legal-reject.

    R(S) with no passing tests is not-evaluable. It is not a retention rate of 0.
    """
    validate_semantic_input(row)
    if row["is_legal_reject"]:
        return "legal-reject"
    if row["reference_pass_count"] == 0 or len(row["passing_test_ids"]) == 0:
        return "not-evaluable"
    return "evaluable"


def textual_merge_file_on_lock(*, outside_base: str, inside_base: str, retries_already_used: int) -> dict:
    """What textual_merge_file must do once it holds the lock.

    A candidate computed outside the lock is valid only when the base is unchanged.
    If the base changed, that candidate is discarded and recomputed. The recompute
    counts as one D8 retry (R2-D2). The 30s clock does not reset. The stale
    candidate is never committed.
    """
    if retries_already_used < 0:
        raise ValueError("retries_already_used must be non-negative")
    if outside_base == inside_base:
        return {
            "discard_outside_candidate": False,
            "recompute": False,
            "counts_as_retry": False,
            "retries_used": retries_already_used,
            "may_commit_outside_candidate": True,
            "clock_resets": False,
            "stop_reason": None,
        }
    if retries_already_used >= MAX_RETRIES_AFTER_FIRST_SUBMIT:
        return {
            "discard_outside_candidate": True,
            "recompute": False,
            "counts_as_retry": False,
            "retries_used": retries_already_used,
            "may_commit_outside_candidate": False,
            "clock_resets": False,
            "stop_reason": "retry-budget-exhausted",
        }
    return {
        "discard_outside_candidate": True,
        "recompute": True,
        "counts_as_retry": True,
        "retries_used": retries_already_used + 1,
        "may_commit_outside_candidate": False,
        "clock_resets": False,
        "stop_reason": None,
    }


def reconcile_terminal(event: dict) -> dict:
    """Final timeout/ack verdict for one proposal. Not final until every write entry point has stopped.

    The item stops at ``item_stop_time``. A proposal sent later does not receive a fresh 30s.
    Its executable time is the remainder until the item stop, capped by its own deadline.
    """
    send_time = float(event["send_time"])
    first_submit = float(event.get("first_submit_time", send_time))
    item_stop = float(event["item_stop_time"])
    own_deadline = first_submit + DEADLINE_SECONDS
    effective_stop = min(own_deadline, item_stop)
    executable = effective_stop - first_submit
    live = list(event.get("live_entry_points") or [])
    identity = {}
    if "proposal_id" in event:
        identity["proposal_id"] = event["proposal_id"]
    if "accepted_prs" in event:
        identity["recorded_accepted_prs"] = list(event["accepted_prs"])
    if not event.get("entry_points_stopped", False) or live:
        return {
            "terminal": "reconciliation-incomplete",
            "final": False,
            "stop_reason": "entry-points-still-live",
            "executable_seconds": executable,
            "counted_as": "not-yet-final",
            "in_throughput": False,
            "acked": False,
            "live_entry_points": live,
            **identity,
        }
    rename_time = event.get("rename_time")
    ack_time = event.get("ack_time")
    rename_on_time = rename_time is not None and float(rename_time) <= effective_stop
    ack_on_time = ack_time is not None and float(ack_time) <= effective_stop
    base = {
        "final": True,
        "executable_seconds": executable,
        "effective_stop": effective_stop,
        "in_throughput": False,
        "time_window_success": False,
        "acked": False,
        **identity,
    }
    if rename_on_time and ack_on_time:
        return {
            **base,
            "terminal": "success",
            "stop_reason": "acked-in-window",
            "counted_as": "in-deadline-success",
            "in_throughput": False,
            "time_window_success": True,
            "acked": True,
        }
    if rename_on_time:
        reason = "ack-missing" if ack_time is None else "ack-late"
        return {**base, "terminal": "durable-unacked", "stop_reason": reason, "counted_as": "reconcile-not-throughput"}
    if rename_time is not None:
        return {**base, "terminal": "late-commit-after-timeout", "stop_reason": "rename-after-stop", "counted_as": "reconcile-not-throughput"}
    stop_reason = "item-stop" if item_stop < own_deadline else "own-deadline"
    return {**base, "terminal": "timeout", "stop_reason": stop_reason, "counted_as": "submitted-not-success"}


def equal_weight_pool(projects: list[dict]) -> dict:
    """Equal-weight mean over the planned project set.

    A project with denominator 0 makes the point estimate and the interval undefined.
    The remaining projects are not dropped and their weights are not increased.
    """
    if not projects:
        raise ValueError("the planned project set is empty")
    count = len(projects)
    weight = 1.0 / count
    for project in projects:
        supplied = project.get("weight")
        if supplied is not None and abs(float(supplied) - weight) > 1e-12:
            raise ValueError("project weights are fixed at 1/K; reweighting is not allowed")
        if int(project["denominator"]) < 0 or int(project["numerator"]) < 0:
            raise ValueError("numerator and denominator must be non-negative")
    zeros = [project["project"] for project in projects if int(project["denominator"]) == 0]
    if zeros:
        return {
            "status": "undefined-zero-denominator",
            "point_estimate": None,
            "interval": None,
            "weight": weight,
            "project_count": count,
            "zero_denominator_projects": zeros,
            "dropped": False,
            "reweighted": False,
        }
    point = sum((int(project["numerator"]) / int(project["denominator"])) * weight for project in projects)
    return {
        "status": "defined",
        "point_estimate": point,
        "interval": None,
        "weight": weight,
        "project_count": count,
        "zero_denominator_projects": [],
        "dropped": False,
        "reweighted": False,
    }


def bootstrap_interval(replicates: list[dict]) -> dict:
    """Percentile interval over pre-registered equal-weight replicates.

    A replicate with a zero denominator is not dropped. The interval stays undefined
    instead of being recomputed on the replicates that still have a denominator.
    """
    if not replicates:
        return {"status": "undefined-zero-denominator", "low": None, "high": None, "dropped": False, "reweighted": False, "undefined_replicates": []}
    undefined = []
    rates = []
    for index, replicate in enumerate(replicates):
        denominator = replicate.get("denominator")
        status = replicate.get("status")
        rate = replicate.get("point_estimate", replicate.get("rate"))
        if status == "undefined-zero-denominator" or denominator == 0 or rate is None:
            undefined.append(index)
        else:
            rates.append(float(rate))
    if undefined:
        return {
            "status": "undefined-zero-denominator",
            "low": None,
            "high": None,
            "dropped": False,
            "reweighted": False,
            "undefined_replicates": undefined,
        }
    ordered = sorted(rates)

    def _percentile(fraction: float) -> float:
        if len(ordered) == 1:
            return ordered[0]
        position = (len(ordered) - 1) * fraction
        lower = int(position)
        upper = min(lower + 1, len(ordered) - 1)
        mix = position - lower
        return ordered[lower] * (1 - mix) + ordered[upper] * mix

    return {
        "status": "defined",
        "low": _percentile(0.025),
        "high": _percentile(0.975),
        "dropped": False,
        "reweighted": False,
        "undefined_replicates": [],
    }


def resample_final_report(projects: list[dict], replicates: list[dict]) -> dict:
    """Final cross-project report. Policy ``point-reported-interval-undefined``.

    The original point estimate stays when every planned project has a positive
    denominator. If any bootstrap replicate has a zero denominator, the interval
    is undefined. The defined replicates are not dropped and are not reweighted
    into a percentile. When the original sample itself has a zero denominator,
    both the point estimate and the interval stay undefined.
    """
    pooled = equal_weight_pool(projects)
    interval = bootstrap_interval(replicates)
    undefined_indexes = list(interval["undefined_replicates"])
    resample_count = len(replicates)
    point_defined = pooled["status"] == "defined"
    interval_defined = point_defined and interval["status"] == "defined" and not undefined_indexes
    fraction = (len(undefined_indexes) / resample_count) if resample_count else None
    return {
        "policy": RESAMPLE_ZERO_POLICY,
        "point_estimate": pooled["point_estimate"] if point_defined else None,
        "point_status": "defined" if point_defined else "undefined-zero-denominator",
        "interval_low": interval["low"] if interval_defined else None,
        "interval_high": interval["high"] if interval_defined else None,
        "interval_status": "defined" if interval_defined else "undefined-zero-denominator",
        "resample_count": resample_count,
        "undefined_resample_count": len(undefined_indexes),
        "undefined_resample_fraction": fraction,
        "undefined_resample_indexes": undefined_indexes,
        "dropped": False,
        "reweighted": False,
        "weight": pooled["weight"],
        "project_count": pooled["project_count"],
        "defined_resample_percentile_not_used": not interval_defined,
    }


def _ack_inconsistencies(terminal: dict, acceptance: dict) -> list[str]:
    """Ack records that disagree are invalid. An unfinished terminal has not made an ack claim."""
    found = []
    if terminal.get("final") is True:
        terminal_acked = terminal.get("acked") is True or terminal.get("terminal") == "success"
        acceptance_acked = acceptance.get("acked") is True
        if terminal_acked != acceptance_acked:
            found.append("inconsistent:ack")
    if "proposal_id" in terminal and "proposal_id" in acceptance and terminal["proposal_id"] != acceptance["proposal_id"]:
        found.append("inconsistent:proposal-id")
    if "recorded_accepted_prs" in terminal and "accepted_prs" in acceptance:
        if legal_set_key(terminal["recorded_accepted_prs"]) != legal_set_key(acceptance["accepted_prs"]):
            found.append("inconsistent:accepted-ids")
    return found


def combined_success(terminal: dict, acceptance: dict) -> dict:
    """Throughput counts a proposal only when time, the legal set, and R(S) all hold.

    A safe full reject stays safety-correct and contributes 0 to throughput.
    Contradictory ack records or proposal ids are ``inconsistent`` and never success.
    """
    reason = acceptance.get("safety_reason")
    base = {
        "time_terminal": terminal.get("terminal"),
        "safety": acceptance.get("safety"),
        "safety_reason": reason,
        "legal": acceptance.get("legal"),
    }
    inconsistencies = _ack_inconsistencies(terminal, acceptance)
    if inconsistencies:
        return {
            **base,
            "status": "inconsistent",
            "counts_as_success": False,
            "in_throughput": False,
            "progress_count": 0,
            "time_window_success": False,
            "mismatch": inconsistencies,
        }
    time_ok = terminal.get("final") is True and terminal.get("terminal") == "success"
    if reason == "full-reject-only-legal-outcome":
        mismatch = []
        if not time_ok:
            mismatch.append(f"time:{terminal.get('terminal')}")
        mismatch.append("throughput:full-reject-only-legal-outcome")
        return {
            **base,
            "status": "full-reject",
            "counts_as_success": False,
            "in_throughput": False,
            "progress_count": 0,
            "time_window_success": time_ok,
            "mismatch": mismatch,
        }
    mismatch = []
    if not time_ok:
        mismatch.append(f"time:{terminal.get('terminal')}")
    if acceptance.get("legal") is not True:
        mismatch.append(f"set:{reason}")
    elif reason not in _BYTES_OK_REASONS:
        mismatch.append(f"bytes:{reason}")
    counts = time_ok and reason in _THROUGHPUT_REASONS
    return {
        **base,
        "status": "success" if counts else "not-success",
        "counts_as_success": counts,
        "in_throughput": counts,
        "progress_count": 1 if counts else 0,
        "time_window_success": time_ok,
        "mismatch": mismatch,
    }


def proposal_final_report(event: dict, answer: dict, run: dict) -> dict:
    """One proposal's final report. Throughput comes only from ``combined_success``."""
    terminal = reconcile_terminal(event)
    acceptance = score_run(answer, run)
    combined = combined_success(terminal, acceptance)
    return {
        "policy": "time-and-legal-set-and-R(S)",
        "status": combined["status"],
        "terminal": terminal,
        "acceptance": acceptance,
        "counts_as_success": combined["counts_as_success"],
        "in_throughput": combined["in_throughput"],
        "progress_count": combined["progress_count"],
        "mismatch": combined["mismatch"],
    }


def _verdict(accepted, **fields) -> dict:
    return {"accepted_prs": list(accepted), **fields}
