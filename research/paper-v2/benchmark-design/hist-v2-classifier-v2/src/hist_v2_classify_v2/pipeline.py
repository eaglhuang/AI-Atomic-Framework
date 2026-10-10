"""Load candidates, materialize PR-intrinsic patches, classify, group, emit."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

from .classify import SideView, decide
from .gitio import (
    GitFailure,
    GitMerger,
    apply_diff,
    best_common_ancestors,
    commit_exists,
    commit_subject,
    committer_time,
    diff_names,
    diff_path,
    full_sha,
    hunks_between,
    is_utf8_text,
    merge_is_conflict,
    merge_is_tool_error,
    name_status,
    op_for,
    read_blob,
    same_commit,
    stable_patch_id,
    touched_paths,
)
from .labels import (
    apply_holdout_leakage,
    assign_clusters,
    assign_ids,
    infer_set,
    semantic_assessment,
    to_z,
)
from .parameters import EXCLUSION_REASONS
from .paths import TEST_RE, is_auto_target

SCHEMA_ITEM = "hist-v2-items/2"
SCHEMA_EXCLUDED = "hist-v2-excluded/2"


class MalformedCandidate(ValueError):
    pass


@dataclass
class PatchIn:
    pr: int
    mb: str
    head: str
    committer_time: str | None
    merged_at: str | None
    gold_test_ids: list | None
    base_validity: str | None
    pre_rebase_head: str | None
    pre_rebase_mb: str | None
    declared_source: str | None


@dataclass
class Candidate:
    project: str
    patches: list[PatchIn]
    base: str | None
    target_file: str | None
    explicit_set: str | None
    index: int
    raw_notes: list[str] = field(default_factory=list)


def load_jsonl(path: str) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise MalformedCandidate(f"{path}:{line_no}: {exc}") from exc
    return rows


def validity_index(rows: list[dict]) -> dict[tuple[str, int], dict]:
    index = {}
    for row in rows:
        try:
            index[(row["project"], int(row["pr"]))] = row
        except (KeyError, TypeError, ValueError) as exc:
            raise MalformedCandidate(f"validity row missing project/pr: {exc}") from exc
    return index


def parse_candidate(row: dict, index: int) -> Candidate:
    row = _normalize_row(row)
    project = row.get("project")
    if not isinstance(project, str) or not project or any(ch.isspace() for ch in project):
        raise MalformedCandidate(f"candidate {index} needs a project slug")
    patches_raw = row.get("patches")
    if not isinstance(patches_raw, list) or not 2 <= len(patches_raw) <= 4:
        raise MalformedCandidate(f"candidate {index} needs 2 to 4 patches")
    patches = [_parse_patch(entry, index) for entry in patches_raw]
    prs = [patch.pr for patch in patches]
    if len(set(prs)) != len(prs):
        raise MalformedCandidate(f"candidate {index} repeats a PR number")
    target = row.get("target_file")
    if target is not None:
        _check_path(target, index)
    explicit = row.get("set")
    if explicit is not None and not isinstance(explicit, str):
        raise MalformedCandidate(f"candidate {index} set must be a string")
    base = row.get("base")
    if base is not None and not isinstance(base, str):
        raise MalformedCandidate(f"candidate {index} base must be a commit sha")
    return Candidate(project, patches, base, target, explicit, index)


def classify_candidates(
    repo: str,
    candidates: list[Candidate],
    rules_sha256: str,
    dev_window: tuple[str, str],
    heldout_window: tuple[str, str],
    merger=None,
) -> tuple[list[dict], list[dict]]:
    merger = merger or GitMerger()
    items: list[dict] = []
    excluded: list[dict] = []
    for candidate in candidates:
        try:
            produced, rejected = _classify_candidate(
                repo, candidate, rules_sha256, dev_window, heldout_window, merger
            )
        except GitFailure as exc:
            if exc.reason not in EXCLUSION_REASONS:
                raise
            rejected = [
                _excluded(
                    candidate,
                    candidate.target_file,
                    exc.reason,
                    exc.message,
                    rules_sha256,
                    dev_window,
                    heldout_window,
                )
            ]
            produced = []
        items.extend(produced)
        excluded.extend(rejected)
    apply_holdout_leakage(items)
    assign_ids(items)
    assign_clusters(items)
    items.sort(key=lambda item: item["id"])
    excluded.sort(key=lambda item: item["id"])
    return items, excluded


def _classify_candidate(repo, candidate, rules_sha256, dev_window, heldout_window, merger):
    if candidate.base is not None and not commit_exists(repo, candidate.base):
        return [], [
            _excluded(
                candidate,
                candidate.target_file,
                "checkout-failed",
                f"base commit missing: {candidate.base}",
                rules_sha256,
                dev_window,
                heldout_window,
            )
        ]
    for patch in candidate.patches:
        if not commit_exists(repo, patch.head):
            return [], [
                _excluded(
                    candidate,
                    candidate.target_file,
                    "head-unavailable",
                    f"PR {patch.pr} head missing: {patch.head}",
                    rules_sha256,
                    dev_window,
                    heldout_window,
                )
            ]
        if not commit_exists(repo, patch.mb):
            return [], [
                _excluded(
                    candidate,
                    candidate.target_file,
                    "checkout-failed",
                    f"PR {patch.pr} mb missing: {patch.mb}",
                    rules_sha256,
                    dev_window,
                    heldout_window,
                )
            ]
    try:
        ancestors = best_common_ancestors(repo, [patch.mb for patch in candidate.patches])
    except GitFailure as exc:
        return [], [
            _excluded(
                candidate,
                candidate.target_file,
                exc.reason if exc.reason in EXCLUSION_REASONS else "tool-execution-error",
                exc.message,
                rules_sha256,
                dev_window,
                heldout_window,
                identities=_identity_stub(candidate, []),
            )
        ]
    if len(ancestors) != 1:
        return [], [
            _excluded(
                candidate,
                candidate.target_file,
                "multiple-best-common-bases",
                "multiple maximal common ancestors: " + ",".join(ancestors),
                rules_sha256,
                dev_window,
                heldout_window,
                identities=_identity_stub(candidate, ancestors),
            )
        ]
    base = ancestors[0]
    supplied_note = None
    if candidate.base is not None and not same_commit(repo, candidate.base, base):
        supplied_note = "supplied-base-replaced-by-true-common-ancestor"
    targets = [candidate.target_file] if candidate.target_file else _auto_targets(repo, candidate)
    if not targets:
        return [], [
            _excluded(
                candidate,
                None,
                "unapplicable-to-common-base",
                "no-common-source-file",
                rules_sha256,
                dev_window,
                heldout_window,
            )
        ]
    items = []
    excluded = []
    for target in targets:
        item, rejection = _classify_target(
            repo,
            candidate,
            base,
            ancestors,
            supplied_note,
            target,
            rules_sha256,
            dev_window,
            heldout_window,
            merger,
        )
        if rejection:
            excluded.append(rejection)
        else:
            items.append(item)
    return items, excluded


def _auto_targets(repo: str, candidate: Candidate) -> list[str]:
    common: set[str] | None = None
    for patch in candidate.patches:
        paths = touched_paths(name_status(repo, patch.mb, patch.head))
        common = paths if common is None else common & paths
    if not common:
        return []
    return sorted(path for path in common if is_auto_target(path))


def _classify_target(
    repo,
    candidate,
    base,
    ancestors,
    supplied_note,
    target,
    rules_sha256,
    dev_window,
    heldout_window,
    merger,
):
    base_blob = read_blob(repo, base, target)
    if not is_utf8_text(base_blob):
        return None, _excluded(
            candidate, target, "binary-or-non-utf8", "base blob is not UTF-8 text", rules_sha256, dev_window, heldout_window
        )
    try:
        sides = [
            _materialize_side(repo, base, base_blob, target, patch)
            for patch in candidate.patches
        ]
    except GitFailure as exc:
        return None, _excluded(
            candidate, target, exc.reason, exc.message, rules_sha256, dev_window, heldout_window
        )
    if all(side.op == "absent" for side in sides):
        return None, _excluded(
            candidate,
            target,
            "unapplicable-to-common-base",
            "no side touches the target file",
            rules_sha256,
            dev_window,
            heldout_window,
        )
    decision = decide(base_blob, sides, merger.merge_file)
    if decision.outcome == "tool-execution-error":
        return None, _excluded(
            candidate,
            target,
            "tool-execution-error",
            "merge tool returned a non-conflict error",
            rules_sha256,
            dev_window,
            heldout_window,
            identities=_commit_identities(repo, candidate, base, ancestors, sides),
        )
    flag, reasons = semantic_assessment(sides)
    preliminary = infer_set(
        [side.merged_at for side in sides],
        candidate.explicit_set,
        dev_window,
        heldout_window,
    )
    ordered = sorted(sides, key=lambda side: (side.committer_time, side.pr))
    item = {
        "schema_version": SCHEMA_ITEM,
        "design_status": "draft-not-frozen-prereg",
        "id": "",
        "project": candidate.project,
        "set": preliminary,
        "base": base,
        "target_file": target,
        "prs": [side.pr for side in ordered],
        "patches": [_public_patch(side, index) for index, side in enumerate(ordered)],
        "send_order": [side.pr for side in ordered],
        "hunk_ranges": _hunk_ranges(ordered),
        "stratum": decision.stratum,
        "min_dist": decision.min_dist,
        "write_class": decision.write_class,
        "semantic_flag": flag,
        "semantic_reasons": reasons,
        "test_purpose_code": decision.test_purpose_code,
        "test_purpose": decision.test_purpose,
        "correct_answer": decision.correct_answer,
        "cluster_id": "",
        "fixed_test_ids": _fixed_tests(ordered),
        "grouping_codes": [],
        "labels": list(decision.labels),
        "concurrency_outcome": decision.outcome,
        "commit_identities": _commit_identities(repo, candidate, base, ancestors, ordered),
        "rules_sha256": rules_sha256,
        "covariates": _covariates(base_blob, ordered),
        "notes": list(decision.notes) + [note for side in ordered for note in side.notes],
        "_blobs": decision.blobs,
    }
    if supplied_note:
        item["notes"].append(supplied_note)
    return item, None


def _materialize_side(repo: str, base: str, base_blob: bytes | None, target: str, patch: PatchIn) -> SideView:
    when = to_z(patch.committer_time) or to_z(committer_time(repo, patch.head))
    if when is None:
        raise GitFailure("checkout-failed", f"PR {patch.pr} has no committer time")
    for rev, label in ((patch.mb, "mb"), (patch.head, "head")):
        blob = read_blob(repo, rev, target)
        if not is_utf8_text(blob):
            raise GitFailure("binary-or-non-utf8", f"PR {patch.pr} {label} blob is not UTF-8 text")
    selected = _place(repo, base, base_blob, target, patch.mb, patch.head, "final-head")
    if selected is None and patch.pre_rebase_head:
        if not commit_exists(repo, patch.pre_rebase_head):
            selected = None
        else:
            pre_mb = patch.pre_rebase_mb or _one_base(repo, [patch.pre_rebase_head, base])
            if not pre_mb or not commit_exists(repo, pre_mb):
                selected = None
            else:
                pre_blob = read_blob(repo, patch.pre_rebase_head, target)
                if not is_utf8_text(pre_blob) or not is_utf8_text(read_blob(repo, pre_mb, target)):
                    raise GitFailure("binary-or-non-utf8", f"PR {patch.pr} pre-rebase blob is not UTF-8 text")
                selected = _place(repo, base, base_blob, target, pre_mb, patch.pre_rebase_head, "rebase-before-head")
    if selected is None:
        selected = _three_way(repo, base_blob, target, patch)
    if selected is None:
        raise GitFailure(
            "unapplicable-to-common-base",
            f"PR {patch.pr} cannot be placed on the common base",
        )
    op, source, after, conflict, sel_mb, sel_head, diff_bytes, notes = selected
    if op == "absent":
        after = base_blob
        conflict = False
    if patch.declared_source == "rebase-before-head" and source == "final-head":
        source = "rebase-before-head"
        notes = [*notes, "declared-rebase-before-head"]
    hunks = []
    if op == "modify" and not conflict and is_utf8_text(after):
        hunks = hunks_between(base_blob, after, target)
    gold = list(patch.gold_test_ids) if patch.gold_test_ids is not None else _discover_gold(repo, sel_mb, sel_head)
    return SideView(
        pr=patch.pr,
        mb=patch.mb,
        head=patch.head,
        selected_mb=sel_mb,
        selected_head=sel_head,
        patch_source=source,
        op=op,
        committer_time=when,
        merged_at=to_z(patch.merged_at),
        after=after,
        hunks=hunks,
        gold_test_ids=sorted(set(gold)),
        base_validity=patch.base_validity,
        transplant_conflict=conflict,
        code_patch_sha256=hashlib.sha256(diff_bytes).hexdigest(),
        notes=notes,
        patch_id=stable_patch_id(diff_bytes),
        commit_subject=commit_subject(repo, sel_head),
        has_patch_bytes=bool(diff_bytes.strip()),
    )


def _place(repo, base, base_blob, target, left, right, source):
    changes = name_status(repo, left, right)
    op = op_for(changes, target)
    diff_bytes = diff_path(repo, left, right, target)
    if op in ("create", "delete", "rename"):
        return op, source, None, False, left, right, diff_bytes, [f"structural-{op}"]
    if op == "absent" and source == "final-head":
        return op, source, base_blob, False, left, right, diff_bytes, ["absent-on-target"]
    ok, after = apply_diff(diff_bytes, base_blob, target)
    if not ok:
        return None
    if not is_utf8_text(after):
        raise GitFailure("binary-or-non-utf8", "applied patch is not UTF-8 text")
    return "modify", source, after, False, left, right, diff_bytes, []


def _three_way(repo, base_blob, target, patch: PatchIn):
    if base_blob is None:
        return None
    mb_blob = read_blob(repo, patch.mb, target)
    head_blob = read_blob(repo, patch.head, target)
    if mb_blob is None or head_blob is None:
        return None
    if not is_utf8_text(mb_blob) or not is_utf8_text(head_blob):
        raise GitFailure("binary-or-non-utf8", f"PR {patch.pr} 3way blob is not UTF-8 text")
    rc, merged = GitMerger().merge_file(base_blob, mb_blob, head_blob)
    if merge_is_tool_error(rc):
        raise GitFailure("tool-execution-error", f"PR {patch.pr} merge-file rc={rc}")
    if not is_utf8_text(merged):
        raise GitFailure("binary-or-non-utf8", f"PR {patch.pr} 3way result is not UTF-8 text")
    diff_bytes = diff_path(repo, patch.mb, patch.head, target)
    conflict = merge_is_conflict(rc)
    notes = ["transplant-conflict"] if conflict else ["3way-clean"]
    after = None if conflict else merged
    return "modify", "3way", after, conflict, patch.mb, patch.head, diff_bytes, notes


def _discover_gold(repo: str, left: str, right: str) -> list[str]:
    return sorted(path for path in diff_names(repo, left, right) if TEST_RE.search(path))


def _public_patch(side: SideView, send_index: int) -> dict:
    return {
        "pr": side.pr,
        "mb": side.mb,
        "head": side.head,
        "selected_mb": side.selected_mb,
        "selected_head": side.selected_head,
        "patch_source": side.patch_source,
        "op": side.op,
        "committer_time": side.committer_time,
        "merged_at": side.merged_at,
        "send_index": send_index,
        "hunks": side.hunks,
        "gold_test_ids": side.gold_test_ids,
        "base_validity": side.base_validity,
        "code_patch_sha256": side.code_patch_sha256,
        "patch_id": side.patch_id,
        "commit_subject": side.commit_subject,
        "has_patch_bytes": side.has_patch_bytes,
        "placement": "transplant-conflict" if side.transplant_conflict else "mergeable",
        "transplant_conflict": side.transplant_conflict,
    }


def _hunk_ranges(sides: list[SideView]) -> list[dict]:
    rows = []
    for side in sides:
        for hunk in side.hunks:
            rows.append({"pr": side.pr, "path": hunk.get("path"), "start": hunk["start"], "end": hunk["end"], "kind": hunk["kind"]})
    rows.sort(key=lambda row: (row["pr"], row["start"], row["end"], row["kind"]))
    return rows


def _fixed_tests(sides: list[SideView]) -> list[str]:
    found = set()
    for side in sides:
        found.update(side.gold_test_ids)
    return sorted(found)


def _covariates(base_blob: bytes | None, sides: list[SideView]) -> dict:
    text = b"" if base_blob is None else base_blob
    lines = text.decode("utf-8").splitlines()
    by_pr = {str(side.pr): len(side.hunks) for side in sides}
    return {
        "target_line_count": len(lines),
        "n_hunks_by_pr": by_pr,
        "n_hunks_total": sum(by_pr.values()),
        "patch_sources": sorted({side.patch_source for side in sides}),
    }


def _one_base(repo: str, revs: list[str]) -> str | None:
    found = best_common_ancestors(repo, revs)
    if len(found) != 1:
        return None
    return found[0]


def _identity_stub(candidate, ancestors: list[str]) -> dict:
    return {
        "algorithm": "git-merge-base--octopus---all-then-maximal",
        "common_base": ancestors[0] if len(ancestors) == 1 else None,
        "common_base_candidates": list(ancestors),
        "supplied_base": candidate.base,
        "inputs": [
            {"pr": patch.pr, "mb": patch.mb, "head": patch.head}
            for patch in sorted(candidate.patches, key=lambda patch: patch.pr)
        ],
    }


def _commit_identities(repo: str, candidate, base: str, ancestors: list[str], sides: list[SideView]) -> dict:
    return {
        "algorithm": "git-merge-base--octopus---all-then-maximal",
        "common_base": full_sha(repo, base),
        "common_base_candidates": [full_sha(repo, sha) for sha in ancestors],
        "supplied_base": None if candidate.base is None else full_sha(repo, candidate.base),
        "inputs": [
            {
                "pr": side.pr,
                "mb": full_sha(repo, side.mb),
                "head": full_sha(repo, side.head),
                "selected_mb": full_sha(repo, side.selected_mb),
                "selected_head": full_sha(repo, side.selected_head),
            }
            for side in sorted(sides, key=lambda side: side.pr)
        ],
    }


def _excluded(candidate, target, reason, message, rules_sha256, dev_window, heldout_window, identities=None) -> dict:
    preliminary = infer_set(
        [patch.merged_at for patch in candidate.patches],
        candidate.explicit_set,
        dev_window,
        heldout_window,
    )
    prs = sorted(patch.pr for patch in candidate.patches)
    pr_part = "_".join(str(pr) for pr in prs)
    target_part = target or "-"
    return {
        "schema_version": SCHEMA_EXCLUDED,
        "id": f"excluded:{candidate.project}:{preliminary}:{pr_part}:{target_part}:{reason}",
        "project": candidate.project,
        "set": preliminary,
        "base": candidate.base,
        "target_file": target,
        "prs": prs,
        "reason": reason,
        "message": message,
        "rules_sha256": rules_sha256,
        "candidate_index": candidate.index,
        "commit_identities": identities,
    }


def _normalize_row(row: dict) -> dict:
    if "patches" in row or not isinstance(row.get("writers"), list):
        return row
    patches = []
    for writer in row["writers"]:
        source = writer.get("writer_version")
        pre_rebase = source == "pre-rebase"
        patches.append(
            {
                "pr": writer.get("pr"),
                "mb": writer.get("mb"),
                "head": writer.get("head"),
                "patch_source": "rebase-before-head" if pre_rebase else writer.get("patch_source"),
                "committer_time": writer.get("committer_time"),
                "merged_at": writer.get("merged_at"),
                "gold_test_ids": writer.get("gold_test_ids"),
                "base_validity": writer.get("base_validity"),
            }
        )
    copied = dict(row)
    copied["patches"] = patches
    if "target_file" not in copied and isinstance(row.get("common_files"), list) and len(row["common_files"]) == 1:
        copied["target_file"] = row["common_files"][0]
    return copied


def _parse_patch(entry: dict, index: int) -> PatchIn:
    if not isinstance(entry, dict):
        raise MalformedCandidate(f"candidate {index} patch is not an object")
    try:
        pr = int(entry["pr"])
    except (KeyError, TypeError, ValueError) as exc:
        raise MalformedCandidate(f"candidate {index} patch needs an integer pr") from exc
    if pr <= 0:
        raise MalformedCandidate(f"candidate {index} PR must be positive")
    mb = entry.get("mb")
    head = entry.get("head")
    if not isinstance(mb, str) or not isinstance(head, str):
        raise MalformedCandidate(f"candidate {index} PR {pr} needs mb and head shas")
    gold = entry.get("gold_test_ids")
    if gold is not None and not isinstance(gold, list):
        raise MalformedCandidate(f"candidate {index} PR {pr} gold_test_ids must be a list")
    validity = entry.get("base_validity")
    if validity is not None and not isinstance(validity, str):
        raise MalformedCandidate(f"candidate {index} PR {pr} base_validity must be a string")
    declared = entry.get("patch_source")
    if declared is not None and declared not in ("final-head", "rebase-before-head", "3way"):
        raise MalformedCandidate(f"candidate {index} PR {pr} has an unknown patch_source")
    return PatchIn(
        pr=pr,
        mb=mb,
        head=head,
        committer_time=entry.get("committer_time"),
        merged_at=entry.get("merged_at"),
        gold_test_ids=gold,
        base_validity=validity,
        pre_rebase_head=entry.get("pre_rebase_head"),
        pre_rebase_mb=entry.get("pre_rebase_mb"),
        declared_source=declared,
    )


def _check_path(path: str, index: int) -> None:
    if not isinstance(path, str) or path.startswith("/") or "\\" in path or path.split("/")[0] in ("", ".", ".."):
        raise MalformedCandidate(f"candidate {index} target_file must be a relative path")
    if any(part in ("", ".", "..") for part in path.split("/")):
        raise MalformedCandidate(f"candidate {index} target_file must stay inside the repo")


def apply_validity(candidates: list[Candidate], index: dict[tuple[str, int], dict]) -> None:
    for candidate in candidates:
        for patch in candidate.patches:
            row = index.get((candidate.project, patch.pr))
            if not row:
                continue
            if patch.gold_test_ids is None and isinstance(row.get("gold_test_ids"), list):
                patch.gold_test_ids = list(row["gold_test_ids"])
            if patch.base_validity is None and isinstance(row.get("base_validity"), str):
                patch.base_validity = row["base_validity"]
