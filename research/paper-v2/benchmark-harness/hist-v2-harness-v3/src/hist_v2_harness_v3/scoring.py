"""Wire classifier v8. Acceptance and semantic evaluation stay separate entries."""

from hist_v2_classify_v8.score import (
    proposal_final_report,
    semantic_status,
    validate_acceptance_input,
    validate_semantic_input,
)

from .digest import sha256_text
from .forensic import assert_clean_observation


def answer_from_fixture(fixture: dict) -> dict:
    allowed = []
    for row in fixture["allowed"]:
        allowed.append(
            {
                "prs": list(row["ids"]),
                "set_key": sorted(row["ids"]),
                "sha256": sha256_text(row["body"]),
                "maximal": bool(row["maximal"]),
            }
        )
    return {
        "allowed": allowed,
        "unchanged_base_sha256": sha256_text(fixture["base"]),
        "full_reject_allowed": bool(fixture.get("full_reject_allowed", False)),
    }


def acceptance_entry(accepted_ids: list[int], body: str, acked: bool, proposal_id: str | None = None) -> dict:
    entry = {
        "kind": "acceptance",
        "accepted_prs": list(accepted_ids),
        "observed_sha256": sha256_text(body),
        "acked": acked,
    }
    if proposal_id is not None:
        entry["proposal_id"] = proposal_id
    return validate_acceptance_input(entry)


def semantic_entry(passing: list[str], retained: list[str], reference_pass_count: int, retained_pass_count: int, is_legal_reject: bool) -> dict:
    if not isinstance(reference_pass_count, int) or isinstance(reference_pass_count, bool):
        raise TypeError("reference_pass_count must be a Python int")
    if not isinstance(retained_pass_count, int) or isinstance(retained_pass_count, bool):
        raise TypeError("retained_pass_count must be a Python int")
    entry = {
        "kind": "semantic-evaluation",
        "passing_test_ids": list(passing),
        "retained_test_ids": list(retained),
        "reference_pass_count": reference_pass_count,
        "retained_pass_count": retained_pass_count,
        "is_legal_reject": is_legal_reject,
    }
    return validate_semantic_input(entry)


def score_fixture_run(run, *, check: bool = True) -> list[dict]:
    """One final report per proposal. Throughput comes only from combined_success."""
    answer = answer_from_fixture(run.fixture)
    accepted = run.accepted_ids
    acked = any(result.accepted and result.ack_at is not None for result in run.results)
    acceptance = acceptance_entry(accepted, run.body, acked)
    item_stop = _item_stop(run.results)
    reports = []
    for result in run.results:
        if not result.accepted:
            reports.append(
                {
                    "proposal_id": result.proposal_id,
                    "arm_terminal": result.arm_terminal,
                    "report": None,
                    "counts_as_success": False,
                }
            )
            continue
        event = {
            "send_time": result.first_submit,
            "first_submit_time": result.first_submit,
            "item_stop_time": item_stop,
            "entry_points_stopped": True,
            "live_entry_points": [],
            "rename_time": result.rename_at,
            "ack_time": result.ack_at,
        }
        report = proposal_final_report(event, answer, acceptance)
        reports.append(
            {
                "proposal_id": result.proposal_id,
                "arm_terminal": result.arm_terminal,
                "report": report,
                "counts_as_success": report["counts_as_success"],
            }
        )
    if check:
        scored = [row["report"]["status"] for row in reports if row["report"] is not None]
        status = "inconsistent" if "inconsistent" in scored else (scored[0] if scored else "not-success")
        signatures = {proposal["id"]: proposal.get("signature") or "" for proposal in run.fixture["proposals"]}
        assert_clean_observation(run.workspace, run.body, accepted, signatures, status)
    return reports


def _item_stop(results) -> float:
    if not results:
        return 30.0
    first = min(result.first_submit for result in results)
    return first + 30.0


def unevaluated_semantic_entry() -> dict:
    """Fixture runs do not execute the reference tests. Empty R(S) tests are not-evaluable."""
    entry = semantic_entry([], [], 0, 0, False)
    if semantic_status(entry) != "not-evaluable":
        raise RuntimeError("an empty reference test list must stay not-evaluable")
    return entry
