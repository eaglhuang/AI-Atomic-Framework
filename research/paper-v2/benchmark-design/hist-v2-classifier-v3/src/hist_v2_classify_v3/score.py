"""Score an ATM run against a classifier answer. Does not regenerate the answer.

Safety uses the accepted set S and the reference bytes R(S).
Progress asks only whether that legal S is maximal.
Functional delivery and semantic retention are separate rows.
"""

from __future__ import annotations


def score_run(answer: dict, run: dict) -> dict:
    """Consume one arm result.

    ``run`` keys: ``accepted_prs`` (the set S the arm presents as landed),
    ``observed_sha256`` (bytes actually in the file), ``acked`` (timely success ack).
    """
    accepted = tuple(sorted({int(pr) for pr in run.get("accepted_prs") or []}))
    observed = run.get("observed_sha256")
    acked = bool(run.get("acked"))
    allowed = {tuple(row["prs"]): row for row in answer.get("allowed") or []}
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

    semantic = [
        row
        for row in accepted_evaluations
        if row.get("has_reference_tests") and not row.get("is_legal_reject")
    ]
    semantic_blind = [
        row
        for row in accepted_evaluations
        if not row.get("has_reference_tests") and not row.get("is_legal_reject")
    ]
    semantic_rejects = [row for row in accepted_evaluations if row.get("is_legal_reject")]
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
            "reason": "no-tests-on-R(S)",
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


def _verdict(accepted, **fields) -> dict:
    return {"accepted_prs": list(accepted), **fields}
