"""Score an ATM run against a classifier answer. Does not regenerate the answer.

Safety uses the accepted set S and the reference bytes R(S).
Progress asks only whether that legal S is maximal.
Functional delivery and semantic retention are separate rows.
"""

from __future__ import annotations

# D8 / R2-D2: retries after the first submit. A 9th retry is not available.
MAX_RETRIES_AFTER_FIRST_SUBMIT = 8
DEADLINE_SECONDS = 30

ACCEPTANCE_FIELDS = ("accepted_prs", "observed_sha256", "acked")
SEMANTIC_FIELDS = ("passing_test_ids", "reference_pass_count", "retained_pass_count", "is_legal_reject")


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
    allowed = {}
    for row in answer.get("allowed") or []:
        allowed[legal_set_key(row.get("set_key", row["prs"]))] = row
    base_sha = answer.get("unchanged_base_sha256")

    if accepted in allowed:
        row = allowed[accepted]
        if observed != row["sha256"]:
            return _verdict(
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
            return _verdict(
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
        return _verdict(
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
            return _verdict(
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
            return _verdict(
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
            return _verdict(
                accepted,
                safety="pass",
                safety_reason="full-reject-only-legal-outcome",
                progress="maximal",
                progress_reason="no-legal-subset",
                legal=True,
                maximal=True,
                reference_sha256=base_sha,
            )
        return _verdict(
            accepted,
            safety="pass",
            safety_reason="no-false-accept",
            progress="shortfall",
            progress_reason="unnecessary-reject",
            legal=True,
            maximal=False,
            reference_sha256=base_sha,
        )

    return _verdict(
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


def validate_acceptance_input(run: dict) -> dict:
    """Formal acceptance input. See schema/score-input.schema.json."""
    if not isinstance(run, dict):
        raise ValueError("acceptance input must be an object")
    missing = [field for field in ACCEPTANCE_FIELDS if field not in run]
    if missing:
        raise ValueError("acceptance input missing " + ",".join(missing))
    prs = run["accepted_prs"]
    if not isinstance(prs, list) or any(isinstance(pr, bool) or not isinstance(pr, int) for pr in prs):
        raise ValueError("accepted_prs must be a list of integers")
    if not isinstance(run["observed_sha256"], str):
        raise ValueError("observed_sha256 must be a string")
    if not isinstance(run["acked"], bool):
        raise ValueError("acked must be a boolean")
    return run


def validate_semantic_input(row: dict) -> dict:
    """Formal semantic-retention input. ``passing_test_ids`` are the tests that pass on R(S)."""
    if not isinstance(row, dict):
        raise ValueError("semantic input must be an object")
    missing = [field for field in SEMANTIC_FIELDS if field not in row]
    if missing:
        raise ValueError("semantic input missing " + ",".join(missing))
    ids = row["passing_test_ids"]
    if not isinstance(ids, list) or any(not isinstance(item, str) for item in ids):
        raise ValueError("passing_test_ids must be a list of strings")
    if isinstance(row["reference_pass_count"], bool) or not isinstance(row["reference_pass_count"], int):
        raise ValueError("reference_pass_count must be an integer")
    if isinstance(row["retained_pass_count"], bool) or not isinstance(row["retained_pass_count"], int):
        raise ValueError("retained_pass_count must be an integer")
    if not isinstance(row["is_legal_reject"], bool):
        raise ValueError("is_legal_reject must be a boolean")
    if row["reference_pass_count"] != len(ids):
        raise ValueError("reference_pass_count must equal the number of passing_test_ids")
    if row["reference_pass_count"] < 0 or row["retained_pass_count"] < 0:
        raise ValueError("counts must be non-negative")
    return row


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
    if not event.get("entry_points_stopped", False) or live:
        return {
            "terminal": "reconciliation-incomplete",
            "final": False,
            "stop_reason": "entry-points-still-live",
            "executable_seconds": executable,
            "counted_as": "not-yet-final",
            "in_throughput": False,
            "live_entry_points": live,
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
    }
    if rename_on_time and ack_on_time:
        return {**base, "terminal": "success", "stop_reason": "acked-in-window", "counted_as": "in-deadline-success", "in_throughput": True}
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


def _verdict(accepted, **fields) -> dict:
    return {"accepted_prs": list(accepted), **fields}
