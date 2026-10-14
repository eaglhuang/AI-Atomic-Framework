"""Replay classifier v8 dev items. Catalog fixtures are refused."""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

from .plan import build_plan
from .sample import load_items, sample_dev

BINDING_SCHEMA = "hist-v2-dev-replay/1"
REFUSAL = (
    "replay binding missing; harness catalog fixtures are not a substitute "
    "for dev items; no run directory created"
)
OP_MAP = {
    "modify": "edit",
    "edit": "edit",
    "create": "create",
    "delete": "delete",
    "rename": "rename",
    "absent": "edit",
}


class ReplayRefused(RuntimeError):
    pass


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def binding_problems(items: list[dict], binding_dir: Path | None) -> list[str]:
    if not items:
        return ["no dev item to bind"]
    catalog = _catalog_fixtures()
    problems: list[str] = []
    directory_ready = binding_dir is not None and binding_dir.is_dir()
    if binding_dir is None:
        problems.append("binding directory missing")
    elif not directory_ready:
        problems.append(f"binding directory missing: {binding_dir}")
    for item in items:
        item_id = str(item.get("id") or "")
        if _is_catalog_item(item, catalog):
            problems.append(f"{item_id}: catalog fixture is not a dev item")
            continue
        if not directory_ready:
            continue
        patches = item.get("patches")
        answer = item.get("correct_answer")
        if not isinstance(patches, list) or not patches or not isinstance(answer, dict):
            problems.append(f"{item_id}: classifier historical patch binding missing")
            continue
        path = _binding_file(binding_dir, item_id)
        if path is None:
            problems.append(f"{item_id}: binding file missing")
            continue
        problems.extend(_check_binding(item, path, catalog))
    return problems


def execute_smoke(
    *,
    repo: Path,
    pins: dict,
    items_path: Path | None,
    binding_dir: Path | None,
    dest: Path,
    date: str,
) -> int:
    if items_path is None:
        _say(REFUSAL)
        return 4
    if dest.exists() and any(dest.iterdir()):
        _say(f"refusing overwrite of {dest}; existing files were left unchanged")
        return 6
    loaded, errors = load_items(items_path)
    sample = sample_dev(loaded, pins)
    sample["errors"] = errors + sample["errors"]
    if sample["errors"]:
        for error in sample["errors"]:
            _say(f"SAMPLE {error}")
        _say("no run directory created")
        return 2
    full = _full_items(loaded)
    if isinstance(full, str):
        _say(f"SAMPLE {full}")
        _say("no run directory created")
        return 2
    selected = [full[row["id"]] for row in sample["selected"]]
    problems = binding_problems(selected, binding_dir)
    if problems:
        for problem in problems:
            _say(f"REPLAY_BINDING {problem}")
        _say(REFUSAL)
        return 4
    plan = build_plan(sample["selected"], pins)
    observations: list[dict] = []
    deviations: list[str] = []
    staging = dest.parent / f".{dest.name}.staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    stopped = False
    try:
        for cell in plan["cells"]:
            item = full[cell["item_id"]]
            try:
                outcome = run_bound_cell(item, _binding_file(binding_dir, item["id"]), cell)
            except (OSError, RuntimeError, ReplayRefused, KeyError) as exc:
                if observations:
                    deviations.append(f"{_cell_name(cell)}: {exc}")
                    stopped = True
                    break
                _say(f"CELL_FAILED {exc}")
                _say("no run directory created")
                return 5
            name = _cell_name(cell)
            target = staging / "cells" / name
            shutil.copytree(outcome["workspace"], target)
            observations.append(outcome["observation"])
            cell["executed"] = True
            if outcome["counterexample"]:
                deviations.append(f"{name}: counterexample {outcome['counterexample']} preserved")
                stopped = True
                break
            _release(outcome["workspace"])
        if not observations:
            _say(REFUSAL)
            return 4
        plan["runs_started"] = len(observations)
        plan["executed"] = not stopped and all(cell["executed"] for cell in plan["cells"])
        counts = _counts(observations)
        from .negative_controls import collect_negative_controls
        from .seal import seal_generation

        def stage_raw(directory: Path) -> None:
            shutil.copytree(staging, directory / "raw")
            summary = directory / "summaries"
            summary.mkdir()
            payload = {
                "trial_only": True,
                "formal_run": False,
                "claims_benchmark_wins": False,
                "evidence_for_c1_c3": False,
                "counts": counts,
            }
            (summary / "counts.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

        code = seal_generation(
            dest,
            date=date,
            pins=pins,
            sample=sample,
            plan=plan,
            observations=observations,
            deviations=deviations,
            negative=collect_negative_controls(),
            stage_raw=stage_raw,
        )
        return code
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def run_bound_cell(item: dict, binding_path: Path | None, cell: dict) -> dict:
    if binding_path is None:
        raise ReplayRefused("binding file missing")
    binding = json.loads(binding_path.read_text(encoding="utf-8"))
    fixture = fixture_from_binding(item, binding)
    import hist_v2_harness_v2.catalog as catalog
    import hist_v2_harness_v2.driver as driver
    from hist_v2_harness_v2.forensic import Counterexample, assert_clean_observation
    from hist_v2_harness_v2.scoring import score_fixture_run

    original_driver = driver.build_patch
    original_catalog = catalog.build_patch
    driver.build_patch = _bound_patch
    catalog.build_patch = _bound_patch
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
        driver.build_patch = original_driver
        catalog.build_patch = original_catalog
    batch_sizes = [result.batch_size for result in run.results if result.batch_size is not None]
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
            "combined_success_count": sum(1 for row in reports if row.get("counts_as_success")),
            "batch_sizes": batch_sizes,
            "terminals": [result.arm_terminal for result in run.results],
            "accepted_ids": list(run.accepted_ids),
            "observed_sha256": run.manifest.get("observed_sha256"),
            "executed": True,
            "source": "classifier-v8-dev-replay",
            "catalog_fixture": False,
            "formal_run": False,
            "claims_benchmark_wins": False,
            "counterexample": kind,
        },
    }


def fixture_from_binding(item: dict, binding: dict) -> dict:
    problems = _check_binding(item, binding, _catalog_fixtures())
    if problems:
        raise ReplayRefused("; ".join(problems))
    by_pr = {int(row["pr"]): row for row in binding["patches"]}
    proposals = []
    order = item.get("send_order") or [row["pr"] for row in item["patches"]]
    patches_by_pr = {int(row["pr"]): row for row in item["patches"]}
    for pr in order:
        source = patches_by_pr[int(pr)]
        bound = by_pr[int(pr)]
        proposals.append(
            {
                "id": int(pr),
                "operation": OP_MAP[source.get("op") or "modify"],
                "unified_diff": bound["unified_diff"],
                "signature": bound.get("signature") or "",
                "rename_to": bound.get("rename_to"),
            }
        )
    allowed = []
    for row in item["correct_answer"]["allowed"]:
        key = _set_key(row.get("set_key") or row.get("prs"))
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
        "replay_source": "classifier-v8-dev-item",
        "catalog_fixture": False,
        "proposals": proposals,
        "allowed": allowed,
    }


def _bound_patch(fixture: dict, proposal: dict) -> str:
    if fixture.get("replay_source") != "classifier-v8-dev-item" or fixture.get("catalog_fixture"):
        raise ReplayRefused("catalog fixture is not a dev item")
    diff = proposal.get("unified_diff")
    if not isinstance(diff, str):
        raise ReplayRefused("historical unified diff missing")
    return diff


def _forensic_kind(run, reports, assert_clean, counterexample_type) -> str | None:
    scored = [row["report"]["status"] for row in reports if row.get("report")]
    status = "inconsistent" if "inconsistent" in scored else (scored[0] if scored else "not-success")
    signatures = {proposal["id"]: proposal.get("signature") or "" for proposal in run.fixture["proposals"]}
    try:
        assert_clean(run.workspace, run.body, run.accepted_ids, signatures, status)
    except counterexample_type as exc:
        return exc.kind
    return None


def _check_binding(item: dict, source, catalog: list[dict]) -> list[str]:
    item_id = str(item.get("id") or "")
    if isinstance(source, Path):
        try:
            binding = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            return [f"{item_id}: binding unreadable ({exc})"]
    else:
        binding = source
    problems = []
    if not isinstance(binding, dict):
        return [f"{item_id}: binding is not an object"]
    if binding.get("schema") != BINDING_SCHEMA:
        problems.append(f"{item_id}: binding schema")
    if binding.get("catalog_fixture") is not False:
        problems.append(f"{item_id}: catalog fixture is not a dev item")
    if binding.get("item_id") != item_id:
        problems.append(f"{item_id}: binding item_id")
    if _is_catalog_item(item, catalog) or _matches_catalog_base(item, binding, catalog):
        problems.append(f"{item_id}: catalog fixture is not a dev item")
    answer = item.get("correct_answer") if isinstance(item.get("correct_answer"), dict) else {}
    base = binding.get("base_text")
    if not isinstance(base, str) or sha256_text(base) != answer.get("unchanged_base_sha256"):
        problems.append(f"{item_id}: base sha256 does not match the answer key")
    bound_patches = binding.get("patches")
    if not isinstance(bound_patches, list):
        problems.append(f"{item_id}: binding patches")
        bound_patches = []
    by_pr = {}
    for row in bound_patches:
        if isinstance(row, dict) and "pr" in row:
            by_pr[int(row["pr"])] = row
    for patch in item.get("patches") or []:
        if not isinstance(patch, dict) or "pr" not in patch:
            problems.append(f"{item_id}: classifier patch missing pr")
            continue
        pr = int(patch["pr"])
        expected = patch.get("code_patch_sha256")
        op = patch.get("op") or "modify"
        if op not in OP_MAP:
            problems.append(f"{item_id}: unsupported patch op {op}")
        if patch.get("has_patch_bytes") is False and expected in (None, ""):
            problems.append(f"{item_id}: historical patch bytes missing for {pr}")
        bound = by_pr.get(pr)
        diff = None if bound is None else bound.get("unified_diff")
        if not isinstance(diff, str) or not isinstance(expected, str) or sha256_text(diff) != expected:
            problems.append(f"{item_id}: unified diff sha256 does not match code_patch_sha256 for {pr}")
    bodies = binding.get("allowed_bodies")
    if not isinstance(bodies, dict):
        problems.append(f"{item_id}: allowed_bodies missing")
        bodies = {}
    for row in answer.get("allowed") or []:
        key = _set_key(row.get("set_key") or row.get("prs"))
        body = bodies.get(key)
        if not isinstance(body, str) or sha256_text(body) != row.get("sha256"):
            problems.append(f"{item_id}: R(S) sha256 mismatch for {key}")
    return problems


def _catalog_fixtures() -> list[dict]:
    from hist_v2_harness_v2.catalog import load_catalog

    return list(load_catalog()["fixtures"])


def _is_catalog_item(item: dict, catalog: list[dict]) -> bool:
    return str(item.get("id") or "") in {row["id"] for row in catalog}


def _matches_catalog_base(item: dict, binding: dict, catalog: list[dict]) -> bool:
    filename = item.get("target_file")
    base = binding.get("base_text")
    for row in catalog:
        if row.get("filename") == filename and row.get("base") == base:
            return True
    return False


def _binding_file(directory: Path | None, item_id: str) -> Path | None:
    if directory is None:
        return None
    direct = directory / f"{item_id}.json"
    if direct.is_file():
        return direct
    digest = hashlib.sha256(item_id.encode("utf-8")).hexdigest()
    hashed = directory / f"{digest}.json"
    if hashed.is_file():
        return hashed
    return None


def _full_items(loaded: list[dict]) -> dict[str, dict] | str:
    found: dict[str, dict] = {}
    for item in loaded:
        item_id = item.get("id")
        if not item_id:
            continue
        if item_id in found:
            return f"duplicate id {item_id}"
        found[str(item_id)] = item
    return found


def _set_key(values) -> str:
    return ",".join(str(int(value)) for value in values)


def _cell_name(cell: dict) -> str:
    item = str(cell["item_id"]).replace("/", "_").replace(":", "_")
    return f"{item}__{cell['arm']}__{cell['order']}__{cell['inter_arrival_ms']}__s{cell['seed']}"


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


def _say(message: str) -> None:
    print(message, file=sys.stderr)


def _release(workspace: Path) -> None:
    from hist_v2_harness_v2.driver import release_workspace

    release_workspace(workspace)
