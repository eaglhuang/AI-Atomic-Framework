"""Run the 29-item HIST-v2 pilot again on harness v3.

Main and held-out stay locked. This module does not edit the prereg, harness
v2, the sealed pilot, or replay v1.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

BINDING_SCHEMA = "hist-v2-dev-replay/2"
FORBIDDEN_STAGES = ("main", "held-out", "heldout")
FORBIDDEN_SETS = ("later-period-historical-holdout", "held-out-project", "held-out")
KNOWN_ITEM = "django:dev:15705_16703:django/db/models/query.py"
KNOWN_PR = 16703
HARNESS_SUMS_SHA = "07a8f10f9894aa64faf42f7aef3daf33c7c685151e9b3318d9bedb1dbad18a59"
V2_SUMS_SHA = "393ea1deec292674d6fe60b2a11ccf6fb47a0c7602af82f2ea2fcf402009e74c"
PREREG_SUMS_SHA = "353caac64fe66cd19afebb3cf16ab2ba010d5810e4250b9156d76bd77144abec"
RULES_SHA = "329165d10ea2fe26885f6e7e06cb065f5cb1e356fc34efd9cce38e1995c97541"
CORE_MERGE_SHA = "cb25242433882d34b514b79338d1a00def53a875"
ARMS = ("steward", "file_lock", "textual_merge_file")
OP_MAP = {
    "modify": "edit",
    "edit": "edit",
    "create": "create",
    "delete": "delete",
    "rename": "rename",
    "absent": "edit",
}


def repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "atm.mjs").is_file():
            return parent
    raise RuntimeError("ATM repository root was not found")


def replay_dir() -> Path:
    return repo_root() / "research/paper-v2/benchmark-main/2026-10-15-hist-v2-dev-replay-v2"


def classified_dir() -> Path:
    return repo_root() / "research/paper-v2/benchmark-main/2026-10-15-hist-v2-classify-v8"


def default_dest(date: str) -> Path:
    return repo_root() / f"research/paper-v2/benchmark-trials/{date}-hist-v2-pilot-r2"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def guard_stage(argv: list[str]) -> int | None:
    for token in argv:
        bare = token.strip().lower()
        if bare.startswith("--stage="):
            bare = bare.split("=", 1)[1]
        bare = bare.lstrip("-")
        if bare in FORBIDDEN_STAGES:
            _say("exit 2: main and held-out stay locked")
            return 2
    return None


def load_pilot_items() -> tuple[list[dict], list[dict]]:
    ids = (replay_dir() / "ITEM_IDS.txt").read_text(encoding="utf-8").splitlines()
    if len(ids) != 29 or len(set(ids)) != 29:
        raise RuntimeError(f"expected 29 replay ids, found {len(ids)}")
    wanted = set(ids)
    found: dict[str, dict] = {}
    refused: list[dict] = []
    for line in (classified_dir() / "items.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        item_set = row.get("set")
        if item_set in FORBIDDEN_SETS:
            refused.append({"id": row.get("id"), "set": item_set})
            continue
        if row.get("id") in wanted:
            found[row["id"]] = row
    missing = [item_id for item_id in ids if item_id not in found]
    if missing:
        raise RuntimeError(f"pilot ids missing or not dev: {missing}")
    selected = []
    full = []
    for item_id in ids:
        item = found[item_id]
        if item.get("set") != "dev":
            raise RuntimeError(f"{item_id} is not dev")
        selected.append(
            {
                "id": item["id"],
                "project": item.get("project"),
                "write_class": item.get("write_class"),
            }
        )
        full.append(item)
    return selected, full


def binding_path(item_id: str) -> Path:
    digest = hashlib.sha256(item_id.encode("utf-8")).hexdigest()
    return replay_dir() / "bindings" / f"{digest}.json"


def fixture_from_binding(item: dict, binding: dict) -> dict:
    if binding.get("schema") != BINDING_SCHEMA:
        raise RuntimeError(f"{item['id']}: binding schema")
    if binding.get("catalog_fixture") is not False or binding.get("item_id") != item["id"]:
        raise RuntimeError(f"{item['id']}: binding identity")
    if item.get("set") != "dev" or item.get("set") in FORBIDDEN_SETS:
        raise RuntimeError(f"{item['id']}: refused set")
    by_pr = {int(row["pr"]): row for row in binding["patches"]}
    patches_by_pr = {int(row["pr"]): row for row in item["patches"]}
    order = item.get("send_order") or [row["pr"] for row in item["patches"]]
    proposals = []
    for pr in order:
        source = patches_by_pr[int(pr)]
        bound = by_pr[int(pr)]
        parent = bound.get("parent_text")
        head = bound.get("head_text")
        diff = bound.get("unified_diff")
        if not isinstance(parent, str) or not isinstance(head, str) or not isinstance(diff, str):
            raise RuntimeError(f"{item['id']}: parent_text, head_text, or unified_diff missing for {pr}")
        proposals.append(
            {
                "id": int(pr),
                "operation": OP_MAP[source.get("op") or "modify"],
                "unified_diff": diff,
                "parent_text": parent,
                "head_text": head,
                "signature": bound.get("signature") or "",
                "rename_to": bound.get("rename_to"),
            }
        )
    allowed = []
    for row in item["correct_answer"]["allowed"]:
        key = ",".join(str(int(value)) for value in (row.get("set_key") or row.get("prs")))
        allowed.append(
            {
                "ids": [int(value) for value in key.split(",")] if key else [],
                "maximal": bool(row["maximal"]),
                "body": binding["allowed_bodies"][key],
            }
        )
    base = binding["base_text"]
    return {
        "id": item["id"],
        "filename": item["target_file"],
        "base": base,
        "base_absent": base == "" and any(row["operation"] == "create" for row in proposals),
        "full_reject_allowed": bool(item["correct_answer"].get("full_reject_allowed")),
        "replay_source": "hist-v2-dev-replay/2",
        "catalog_fixture": False,
        "proposals": proposals,
        "allowed": allowed,
    }


def _prepare_nested(original):
    def prepare(root, fixture):
        target = Path(root) / str(fixture["filename"])
        target.parent.mkdir(parents=True, exist_ok=True)
        return original(root, fixture)

    return prepare


def _cell_name(cell: dict) -> str:
    item = str(cell["item_id"]).replace("/", "_").replace(":", "_")
    return f"{item}__{cell['arm']}__{cell['order']}__{cell['inter_arrival_ms']}__s{cell['seed']}"


def run_cell(item: dict, cell: dict) -> dict:
    import hist_v2_harness_v3.driver as driver
    from hist_v2_harness_v3.forensic import Counterexample, assert_clean_observation
    from hist_v2_harness_v3.scoring import score_fixture_run

    binding = json.loads(binding_path(item["id"]).read_text(encoding="utf-8"))
    fixture = fixture_from_binding(item, binding)
    original = driver.prepare_workspace
    driver.prepare_workspace = _prepare_nested(original)
    try:
        run = driver.run_fixture(
            fixture,
            cell["arm"],
            order=cell["order"],
            inter_arrival_ms=int(cell["inter_arrival_ms"]),
            seed=int(cell["seed"]),
            keep=True,
        )
        reports = score_fixture_run(run, check=False)
        kind = _forensic_kind(run, reports, assert_clean_observation, Counterexample)
    finally:
        driver.prepare_workspace = original
    by_id = {int(row["proposal_id"]): row for row in reports}
    scored = []
    for result in run.results:
        report = by_id[int(result.proposal_id)]
        detail = result.detail
        scored.append(
            {
                "proposal_id": int(result.proposal_id),
                "arm_terminal": result.arm_terminal,
                "stop_reason": result.stop_reason,
                "counts_as_success": bool(report.get("counts_as_success")),
                "detail": None if detail is None else str(detail)[:240],
            }
        )
    return {
        "workspace": run.workspace,
        "counterexample": kind,
        "observation": {
            "item_id": item["id"],
            "project": item.get("project"),
            "write_class": item.get("write_class"),
            "arm": cell["arm"],
            "seed": cell["seed"],
            "order": cell["order"],
            "inter_arrival_ms": cell["inter_arrival_ms"],
            "proposal_count": len(run.results),
            "combined_success_count": sum(1 for row in scored if row["counts_as_success"]),
            "batch_sizes": [result.batch_size for result in run.results if result.batch_size is not None],
            "terminals": [result.arm_terminal for result in run.results],
            "results": scored,
            "accepted_ids": list(run.accepted_ids),
            "observed_sha256": run.manifest.get("observed_sha256"),
            "executed": True,
            "source": "hist-v2-dev-replay/2",
            "catalog_fixture": False,
            "formal_run": False,
            "claims_benchmark_wins": False,
            "counterexample": kind,
            "harness": "hist-v2-harness-v3",
        },
    }


def _forensic_kind(run, reports, assert_clean, counterexample_type) -> str | None:
    scored = [row["report"]["status"] for row in reports if row.get("report")]
    status = "inconsistent" if "inconsistent" in scored else (scored[0] if scored else "not-success")
    signatures = {proposal["id"]: proposal.get("signature") or "" for proposal in run.fixture["proposals"]}
    try:
        assert_clean(run.workspace, run.body, run.accepted_ids, signatures, status)
    except counterexample_type as exc:
        return exc.kind
    return None


def assert_known_mine(items: list[dict]) -> None:
    """One textual cell must land PR 16703. file_lock must still reject that hunk."""
    item = next(row for row in items if row["id"] == KNOWN_ITEM)
    textual = run_cell(
        item,
        {"item_id": item["id"], "arm": "textual_merge_file", "order": "forward", "inter_arrival_ms": 0, "seed": 0},
    )
    locked = run_cell(
        item,
        {"item_id": item["id"], "arm": "file_lock", "order": "forward", "inter_arrival_ms": 0, "seed": 0},
    )
    try:
        textual_row = next(row for row in textual["observation"]["results"] if row["proposal_id"] == KNOWN_PR)
        lock_row = next(row for row in locked["observation"]["results"] if row["proposal_id"] == KNOWN_PR)
        if textual_row["arm_terminal"] == "error" or not textual_row["counts_as_success"]:
            raise RuntimeError(f"textual did not land {KNOWN_PR}: {textual_row}")
        if lock_row["arm_terminal"] != "rejected-conflict":
            raise RuntimeError(f"file_lock terminal for {KNOWN_PR}: {lock_row}")
        _say(
            f"PREFLIGHT textual {KNOWN_PR} {textual_row['arm_terminal']} "
            f"file_lock {lock_row['arm_terminal']}"
        )
    finally:
        _release(textual["workspace"])
        _release(locked["workspace"])


def pins() -> dict:
    _require_hash(
        repo_root() / "research/paper-v2/benchmark-harness/hist-v2-harness-v3/SHA256SUMS",
        HARNESS_SUMS_SHA,
    )
    _require_hash(
        repo_root() / "research/paper-v2/benchmark-harness/hist-v2-harness-v2/SHA256SUMS",
        V2_SUMS_SHA,
    )
    _require_hash(
        repo_root() / "research/paper-v2/benchmark-prereg/2026-10-14-hist-v2.0/SHA256SUMS",
        PREREG_SUMS_SHA,
    )
    rules = repo_root() / "research/paper-v2/benchmark-design/hist-v2-classifier-v8/RULES.md"
    if sha256_file(rules) != RULES_SHA:
        raise RuntimeError("classifier RULES.md hash drifted")
    return {
        "trial_banner": "pilot-r2 — 不得作為論文結果",
        "generation_kind_line": "這是 pilot-r2 封存，不是論文結果。用 harness v3 與 hist-v2-dev-replay/2。主跑與留出集沒有執行。",
        "report_scope_line": "區間：未計算。pilot-r2 停在計數，不估計比較區間，不進正式結果。",
        "core_merge_sha": CORE_MERGE_SHA,
        "classifier_rules_sha256": RULES_SHA,
        "harness_sha256sums_sha256": HARNESS_SUMS_SHA,
        "prereg_sha256sums_sha256": PREREG_SUMS_SHA,
        "arms": list(ARMS),
        "comparison_arms": list(ARMS),
        "inter_arrival_ms": [0, 50, 100, 500, 2000],
        "orders": ["forward", "reverse"],
        "seeds": [0, 1],
        "note_file_lock_contrast": False,
        "arm_mapping": (
            "凍結預先登記 r7 §3.1 與 §7 的主比較是三條臂。§3 所說的 ATM 臂是 steward："
            "候選由 ATM 批次協調器合成。它不是 harness 裡另外一條名叫 atm 的臂。"
            "occ 與 git 三方收成 textual_merge_file。bare_composer 不在主比較裡。"
            "本次 pilot-r2 只跑 steward、file_lock、textual_merge_file。harness 的 atm 臂不跑。"
        ),
        "declared_deviations": [
            "凍結 r7 §8 沒有密封 pilot 題數。這次沿用已封存 pilot 的同一 29 題 dev，不重新抽題，也不改預先登記。留出集不抽。",
            "harness v3 已套用 §9 均勻抖動。v2 缺抖動的那一條偏離在這次關閉。v2 位元組沒有改。",
            "輸入是新的 hist-v2-dev-replay/2，每份 proposal 帶 parent_text 與 head_text。v1 綁定沒有改。",
            "作者於 2026-10-15 批准重建 replay 並用 harness v3 重跑這份 pilot。仍是 pilot，不是論文結果。",
        ],
    }


def _require_hash(path: Path, expected: str) -> None:
    digest = sha256_file(path)
    if digest != expected:
        raise RuntimeError(f"{path} sha256 {digest} != {expected}")


def execute(date: str, dest: Path, *, preflight: bool = True) -> int:
    blocked = guard_stage([date, str(dest)])
    if blocked is not None:
        return blocked
    if dest.exists() and any(dest.iterdir()):
        _say(f"refusing overwrite of {dest}")
        return 6
    sealed_pilot = repo_root() / "research/paper-v2/benchmark-trials/2026-10-15-hist-v2-pilot"
    if dest.resolve() == sealed_pilot.resolve():
        _say("refusing to write the sealed pilot")
        return 6
    selected, full = load_pilot_items()
    by_id = {item["id"]: item for item in full}
    if preflight:
        assert_known_mine(full)
    from hist_v2_smoke_runbook.plan import build_plan
    from hist_v2_smoke_runbook.seal import seal_generation

    plan_pins = pins()
    plan = build_plan(selected, plan_pins)
    observations: list[dict] = []
    deviations = list(plan_pins["declared_deviations"])
    staging = dest.parent / f".{dest.name}.staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    stopped = False
    try:
        for cell in plan["cells"]:
            item = by_id[cell["item_id"]]
            try:
                outcome = run_cell(item, cell)
            except (OSError, RuntimeError, KeyError) as exc:
                if observations:
                    deviations.append(f"{_cell_name(cell)}: {exc}")
                    stopped = True
                    break
                _say(f"CELL_FAILED {exc}")
                return 5
            name = _cell_name(cell)
            _say(f"CELL {len(observations) + 1}/{len(plan['cells'])} {name}")
            shutil.copytree(outcome["workspace"], staging / "cells" / name)
            observations.append(outcome["observation"])
            cell["executed"] = True
            if outcome["counterexample"]:
                deviations.append(f"{name}: counterexample {outcome['counterexample']} preserved")
                stopped = True
                break
            _release(outcome["workspace"])
        if not observations:
            _say("no observations")
            return 4
        plan["runs_started"] = len(observations)
        plan["executed"] = not stopped and all(cell["executed"] for cell in plan["cells"])
        sample = {
            "selected": selected,
            "missing_classes": ["B'", "D"],
            "refused": _refused_rows(),
            "errors": [],
        }
        plan_pins["report_notes"] = readout_notes(observations)
        negative = collect_negative_controls()

        def stage_raw(directory: Path) -> None:
            shutil.copytree(staging, directory / "raw")
            summary = directory / "summaries"
            summary.mkdir()
            payload = {
                "trial_only": True,
                "formal_run": False,
                "claims_benchmark_wins": False,
                "pilot_r2": True,
                "counts": _counts(observations),
                "terminals": terminal_rows(observations),
                "errors": error_rows(observations),
                "tie": tie_report(observations),
                "per_item": per_item_rows(observations),
            }
            (summary / "breakdown.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

        return seal_generation(
            dest,
            date=date,
            pins=plan_pins,
            sample=sample,
            plan=plan,
            observations=observations,
            deviations=deviations,
            negative=negative,
            stage_raw=stage_raw,
        )
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def collect_negative_controls() -> dict:
    from hist_v2_harness_v3.negative import CONTROLS, inject

    rows = []
    for name in CONTROLS:
        caught = inject(name)
        combined = bool(caught["combined"].get("counts_as_success"))
        rows.append(
            {
                "control": name,
                "injected": True,
                "caught_as": caught["caught_as"],
                "combined_success": combined,
                "caught": bool(caught["caught_as"]) and not combined,
            }
        )
    return {
        "injected": True,
        "all_caught": all(row["caught"] for row in rows) and len(rows) == len(CONTROLS),
        "controls": rows,
    }


def _refused_rows() -> list[dict]:
    refused = []
    for line in (classified_dir() / "items.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("set") in FORBIDDEN_SETS:
            refused.append({"id": row.get("id"), "set": row.get("set")})
    return refused


def _counts(observations: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in observations:
        grouped.setdefault((str(row.get("arm")), str(row.get("write_class"))), []).append(row)
    rows = []
    for arm, write_class in sorted(grouped):
        bucket = grouped[(arm, write_class)]
        rows.append(
            {
                "arm": arm,
                "write_class": write_class,
                "cells": len(bucket),
                "combined_success_count": sum(int(row.get("combined_success_count") or 0) for row in bucket),
                "proposal_count": sum(int(row.get("proposal_count") or 0) for row in bucket),
            }
        )
    return rows


def terminal_rows(observations: list[dict]) -> list[dict]:
    counter: Counter[tuple[str, str, int, str]] = Counter()
    for row in observations:
        for result in row.get("results") or []:
            counter[(row["arm"], str(row["write_class"]), int(row["inter_arrival_ms"]), result["arm_terminal"])] += 1
    return [
        {
            "arm": arm,
            "write_class": write_class,
            "inter_arrival_ms": interval,
            "arm_terminal": terminal,
            "count": count,
        }
        for (arm, write_class, interval, terminal), count in sorted(counter.items())
    ]


def error_rows(observations: list[dict]) -> list[dict]:
    found = []
    for row in observations:
        for result in row.get("results") or []:
            if result["arm_terminal"] != "error":
                continue
            found.append(
                {
                    "item_id": row["item_id"],
                    "arm": row["arm"],
                    "write_class": row["write_class"],
                    "inter_arrival_ms": row["inter_arrival_ms"],
                    "seed": row["seed"],
                    "order": row["order"],
                    "proposal_id": result["proposal_id"],
                    "stop_reason": result["stop_reason"],
                    "detail": result["detail"],
                }
            )
    return found


def tie_report(observations: list[dict]) -> dict:
    grouped: dict[tuple, dict] = {}
    for row in observations:
        if row["arm"] not in ("steward", "textual_merge_file"):
            continue
        key = (row["item_id"], row["seed"], row["order"], row["inter_arrival_ms"])
        grouped.setdefault(key, {})[row["arm"]] = row
    same = 0
    differ = []
    for key, arms in sorted(grouped.items()):
        if set(arms) != {"steward", "textual_merge_file"}:
            continue
        left = arms["steward"]
        right = arms["textual_merge_file"]
        matched = (
            left.get("observed_sha256") == right.get("observed_sha256")
            and list(left.get("accepted_ids") or []) == list(right.get("accepted_ids") or [])
            and left.get("combined_success_count") == right.get("combined_success_count")
        )
        if matched:
            same += 1
            continue
        differ.append(
            {
                "item_id": key[0],
                "seed": key[1],
                "order": key[2],
                "inter_arrival_ms": key[3],
                "write_class": left.get("write_class"),
                "steward_accepted_ids": left.get("accepted_ids"),
                "textual_accepted_ids": right.get("accepted_ids"),
                "steward_sha256": left.get("observed_sha256"),
                "textual_sha256": right.get("observed_sha256"),
                "steward_combined_success_count": left.get("combined_success_count"),
                "textual_combined_success_count": right.get("combined_success_count"),
            }
        )
    return {"groups": same + len(differ), "byte_and_acceptance_tie": same, "differ": differ}


def per_item_rows(observations: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in observations:
        grouped.setdefault((row["item_id"], row["arm"]), []).append(row)
    rows = []
    for item_id, arm in sorted(grouped):
        bucket = grouped[(item_id, arm)]
        rows.append(
            {
                "item_id": item_id,
                "arm": arm,
                "write_class": bucket[0].get("write_class"),
                "cells": len(bucket),
                "combined_success_count": sum(int(row.get("combined_success_count") or 0) for row in bucket),
                "proposal_count": sum(int(row.get("proposal_count") or 0) for row in bucket),
                "error_count": sum(
                    1
                    for row in bucket
                    for result in row.get("results") or []
                    if result["arm_terminal"] == "error"
                ),
            }
        )
    return rows


def readout_notes(observations: list[dict]) -> list[str]:
    notes = [
        "這是 pilot-r2 的計數。不是論文結果，沒有勝出主張。",
        "抖動由 harness v3 依 seed、題目、順序、間隔與 writer index 決定。file_lock 仍用歷史 hunk，不用 git merge-file。",
    ]
    notes.append(_class_note(observations, "A'"))
    notes.append(_class_note(observations, "A"))
    notes.append(_class_note(observations, "B"))
    notes.append(_class_note(observations, "C"))
    errors = error_rows(observations)
    notes.append(f"終態 error 的 proposal 次數：{len(errors)}。明細在 summaries/breakdown.json。")
    tie = tie_report(observations)
    notes.append(
        "steward 與 textual_merge_file 在 "
        f"{tie['byte_and_acceptance_tie']}／{tie['groups']} 組（題目 × seed × 順序 × 間隔）"
        "的 accepted_ids、observed_sha256 與 combined_success 相同。"
        "兩者都對同一個三方 mine 用 git merge-file。收進同一個 S 時位元組相同是這個接線的結果。"
        "這不是把兩條臂看成同一條，也不是勝出。真衝突題可以只收下不同的單例。"
    )
    if tie["differ"]:
        classes = sorted({row["write_class"] for row in tie["differ"]})
        notes.append(f"兩者不同的組有 {len(tie['differ'])}。類別：{'、'.join(str(item) for item in classes)}。")
    else:
        notes.append("這次沒有 steward 與 textual_merge_file 不同的組。")
    return notes


def _class_note(observations: list[dict], write_class: str) -> str:
    grouped: dict[tuple, dict] = {}
    for row in observations:
        if str(row.get("write_class")) != write_class:
            continue
        key = (row["item_id"], row["seed"], row["order"], row["inter_arrival_ms"])
        grouped.setdefault(key, {})[row["arm"]] = int(row.get("combined_success_count") or 0)
    cells = len(grouped)
    one_vs_two = 0
    for arms in grouped.values():
        if arms.get("file_lock") == 1 and arms.get("steward") == 2 and arms.get("textual_merge_file") == 2:
            one_vs_two += 1
    totals = Counter()
    proposals = Counter()
    for row in observations:
        if str(row.get("write_class")) != write_class:
            continue
        totals[row["arm"]] += int(row.get("combined_success_count") or 0)
        proposals[row["arm"]] += int(row.get("proposal_count") or 0)
    parts = []
    for arm in ARMS:
        parts.append(f"{arm} {totals[arm]}／{proposals[arm]}")
    return (
        f"類別 {write_class}：格子 {cells}。"
        f"file_lock 的 combined_success 為 1 且另外兩條臂為 2 的格子有 {one_vs_two}。"
        f"合計 {'；'.join(parts)}。"
    )


def _release(workspace: Path) -> None:
    from hist_v2_harness_v3.driver import release_workspace

    release_workspace(workspace)


def _say(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def main(argv: list[str]) -> int:
    blocked = guard_stage(argv)
    if blocked is not None:
        return blocked
    if not argv or argv[0] in ("-h", "--help"):
        _say("usage: run_pilot_r2.py run [--date 2026-10-15] | check-fixture")
        return 0
    command = argv[0]
    if command == "check-fixture":
        _selected, full = load_pilot_items()
        item = next(row for row in full if row["id"] == KNOWN_ITEM)
        fixture = fixture_from_binding(item, json.loads(binding_path(item["id"]).read_text(encoding="utf-8")))
        proposal = next(row for row in fixture["proposals"] if row["id"] == KNOWN_PR)
        if not proposal["parent_text"] or not proposal["head_text"]:
            return 2
        _say(f"FIXTURE {fixture['id']} parent_bytes {len(proposal['parent_text'])}")
        return 0
    if command != "run":
        _say(f"unknown command {command}")
        return 2
    date = "2026-10-15"
    if "--date" in argv:
        date = argv[argv.index("--date") + 1]
    dest = default_dest(date)
    if "--dest" in argv:
        dest = Path(argv[argv.index("--dest") + 1])
    return execute(date, dest)


__all__ = [
    "BINDING_SCHEMA",
    "fixture_from_binding",
    "guard_stage",
    "load_pilot_items",
    "main",
]
