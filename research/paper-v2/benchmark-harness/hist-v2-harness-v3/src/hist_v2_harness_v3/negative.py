"""Five write-layer negative controls. Each one is an injection, not a real run.

The frozen prereg section 5 does not name a different list of five. It requires
write-layer loss and corruption to be caught, and it requires the safety
contracts covered beside these controls. Issue #291 names the five injections
below. They are scored by classifier v8.
"""

from hist_v2_classify_v8.score import combined_success, proposal_final_report, reconcile_terminal

from .catalog import load_catalog
from .digest import sha256_text
from .scoring import acceptance_entry, answer_from_fixture

CONTROLS = (
    "lost-accepted-proposal",
    "partial-apply",
    "bytes-do-not-match-R(S)",
    "illegal-subset",
    "late-write-after-timeout",
)


def _fixture(name: str) -> dict:
    for fixture in load_catalog()["fixtures"]:
        if fixture["id"] == name:
            return fixture
    raise KeyError(name)


def inject(control: str) -> dict:
    if control not in CONTROLS:
        raise KeyError(control)
    disjoint = _fixture("disjoint")
    conflict = _fixture("true-conflict")
    fixture = conflict if control == "illegal-subset" else disjoint
    answer = answer_from_fixture(fixture)
    maximal = next(row for row in disjoint["allowed"] if row["maximal"] and row["ids"] == [1, 2])
    singleton = next(row for row in disjoint["allowed"] if row["ids"] == [1])
    event = {
        "send_time": 0.0,
        "first_submit_time": 0.0,
        "item_stop_time": 30.0,
        "entry_points_stopped": True,
        "live_entry_points": [],
        "rename_time": 1.0,
        "ack_time": 1.0,
        "proposal_id": "1",
    }
    if control == "lost-accepted-proposal":
        body = singleton["body"]
        acceptance = acceptance_entry([1, 2], body, True)
        caught = "bytes-do-not-match-R(S)"
    elif control == "partial-apply":
        body = singleton["body"]
        acceptance = acceptance_entry([1, 2], body, True)
        caught = "bytes-do-not-match-R(S)"
    elif control == "bytes-do-not-match-R(S)":
        body = maximal["body"].replace("BETA", "BETX", 1)
        acceptance = acceptance_entry([1, 2], body, True)
        caught = "bytes-do-not-match-R(S)"
    elif control == "illegal-subset":
        body = "alpha\nBOTH\ngamma\ndelta\nepsilon\nzeta\n"
        acceptance = acceptance_entry([1, 2], body, True)
        caught = "illegal-set"
    else:
        body = maximal["body"]
        acceptance = acceptance_entry([1, 2], body, False)
        event["rename_time"] = 31.0
        event["ack_time"] = None
        caught = "late-commit-after-timeout"
    report = proposal_final_report(event, answer, acceptance)
    terminal = reconcile_terminal(event)
    combined = combined_success(terminal, report["acceptance"])
    return {
        "control": control,
        "injected": True,
        "caught_as": caught,
        "body_sha256": sha256_text(body),
        "report": report,
        "terminal": terminal,
        "combined": combined,
        "lost_effect_ids": [2] if control == "lost-accepted-proposal" else [],
        "partial": control == "partial-apply",
    }
