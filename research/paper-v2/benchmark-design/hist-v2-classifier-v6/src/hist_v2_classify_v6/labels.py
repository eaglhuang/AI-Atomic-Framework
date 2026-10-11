"""Test purpose, semantic flag, windows, clusters, and holdout leakage."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from .parameters import DEV_WINDOW, GROUPING_CODES, HELDOUT_WINDOW, LATER_PERIOD_SET

_BACKPORT = re.compile(r"backport", re.IGNORECASE)

PURPOSES = {
    "A": ("general-write", "一般寫入測試"),
    "B": ("composition", "合成測試"),
    "C": ("reject", "拒絕測試"),
    "A'": ("identical-edits", "相同編輯附加層（不併入 A／B／C）"),
    "B'": ("order-dependent-merge", "順序相依合併附加層（不併入 A／B／C）"),
    "D": ("write-safety", "寫入安全測試（被拒絕時必須 fail-closed）"),
}


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if len(text) == 10:
        text = text + "T00:00:00Z"
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


def to_z(value: str | None) -> str | None:
    parsed = parse_time(value)
    if parsed is None:
        return None
    return parsed.strftime("%Y-%m-%dT%H:%M:%SZ")


def utc_date(value: str | None) -> str | None:
    parsed = parse_time(value)
    if parsed is None:
        return None
    return parsed.strftime("%Y-%m-%d")


def in_window(date: str, window: tuple[str, str]) -> bool:
    return window[0] <= date <= window[1]


def infer_set(
    merged_ats: list[str | None],
    explicit: str | None,
    dev_window: tuple[str, str] = DEV_WINDOW,
    heldout_window: tuple[str, str] = HELDOUT_WINDOW,
) -> str:
    if explicit == "held-out-project":
        return "held-out-project"
    dates = [utc_date(value) for value in merged_ats]
    known = [date for date in dates if date]
    if known and len(known) == len(merged_ats) and all(in_window(date, dev_window) for date in known):
        return "dev"
    if known and len(known) == len(merged_ats) and all(in_window(date, heldout_window) for date in known):
        return LATER_PERIOD_SET
    if explicit in {"held-out", LATER_PERIOD_SET} and not (
        known and len(known) == len(merged_ats) and all(in_window(date, dev_window) for date in known)
    ):
        if not known or all(in_window(date, heldout_window) for date in known):
            return LATER_PERIOD_SET
    if not known and explicit in {"dev", "dev-cross-window", "cross-window", LATER_PERIOD_SET, "held-out"}:
        return LATER_PERIOD_SET if explicit == "held-out" else explicit
    if known:
        return "cross-window"
    return explicit or "unspecified"


def semantic_assessment(sides: list) -> tuple[str, list[str]]:
    """Return (flag, reasons). S only when every side is gold-valid and not pre-rebase."""
    reasons: list[str] = []
    if any(side.patch_source == "rebase-before-head" for side in sides):
        reasons.append("rebase-before-head")
    if any(side.base_validity == "unbuildable" for side in sides):
        reasons.append("base-env-unbuildable")
    if any(not side.gold_test_ids for side in sides):
        reasons.append("no-gold")
    if any(side.base_validity in (None, "", "not-provided") for side in sides):
        reasons.append("base-validity-not-provided")
    if any(
        side.base_validity not in (None, "", "not-provided", "pass", "unbuildable")
        for side in sides
    ):
        reasons.append("base-validity-failed")
    if reasons:
        return "N", reasons
    return "S", []


def apply_holdout_leakage(items: list) -> None:
    """Mark later-period / cross-window / project-holdout rows that touch dev.

    Shared-PR connectivity is the full connected component, so (1,2)/(2,3)/(3,4)
    is one component. Identical patches, cherry-picks, and backports add edges.
    A row is no longer unseen once its component reaches a dev row.
    """
    if not items:
        return
    for item in items:
        item.setdefault("grouping_codes", [])
        item.setdefault("covariates", {})
        item["covariates"]["original_set"] = item.get("set")
    find, edges = _link(items)
    pr_groups: dict[int, list[int]] = {}
    find_pr, _ignored = _link(items, patches=False)
    for index in range(len(items)):
        pr_groups.setdefault(find_pr(index), []).append(index)

    contaminated = {index for index, item in enumerate(items) if item.get("set") == "dev"}
    codes: dict[int, set[str]] = {index: set() for index in range(len(items))}
    changed = True
    while changed:
        changed = False
        for group in pr_groups.values():
            if not any(index in contaminated for index in group):
                continue
            for index in group:
                if items[index].get("set") == "dev":
                    continue
                if index not in contaminated or "shared-pr-component-leak" not in codes[index]:
                    contaminated.add(index)
                    if "shared-pr-component-leak" not in codes[index]:
                        codes[index].add("shared-pr-component-leak")
                        changed = True
        for (left, right), reasons in edges.items():
            for src, dst in ((left, right), (right, left)):
                if src not in contaminated or items[dst].get("set") == "dev":
                    continue
                if dst not in contaminated:
                    contaminated.add(dst)
                    changed = True
                leak_names = {f"{reason}-leak" for reason in reasons}
                if not leak_names <= codes[dst]:
                    codes[dst].update(leak_names)
                    changed = True

    for index, item in enumerate(items):
        if item.get("set") == "dev":
            continue
        extra = sorted(code for code in codes[index] if code in GROUPING_CODES)
        for code in extra:
            if code not in item["grouping_codes"]:
                item["grouping_codes"].append(code)
        if extra:
            item["set"] = "dev-cross-window"
    del find


def assign_ids(items: list) -> None:
    seen: dict[str, int] = {}
    for item in items:
        pr_part = "_".join(str(pr) for pr in sorted(item["prs"]))
        base_id = f"{item['project']}:{item['set']}:{pr_part}:{item['target_file']}"
        count = seen.get(base_id, 0) + 1
        seen[base_id] = count
        item["id"] = base_id if count == 1 else f"{base_id}~{count}"


def assign_clusters(items: list) -> None:
    if not items:
        return
    find, _edges = _link(items)
    groups: dict[int, list] = {}
    for index, item in enumerate(items):
        groups.setdefault(find(index), []).append(item)
    for group in groups.values():
        cluster_id = min(item["id"] for item in group)
        for item in group:
            item["cluster_id"] = cluster_id


def _link(items: list, patches: bool = True):
    parent = list(range(len(items)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    owners: dict[tuple[str, int], int] = {}
    for index, item in enumerate(items):
        for pr in item.get("prs") or []:
            key = (item["project"], int(pr))
            if key in owners:
                union(owners[key], index)
            else:
                owners[key] = index
    edges: dict[tuple[int, int], set[str]] = {}
    if patches:
        sha_owner: dict[tuple[str, str], tuple[int, int]] = {}
        pid_owner: dict[tuple[str, str], tuple[int, str, int]] = {}
        for index, item in enumerate(items):
            for patch in item.get("patches") or []:
                if not patch.get("has_patch_bytes"):
                    continue
                pr = int(patch["pr"])
                digest = patch.get("code_patch_sha256") or ""
                patch_id = patch.get("patch_id") or ""
                subject = patch.get("commit_subject") or ""
                if digest:
                    key = (item["project"], digest)
                    if key in sha_owner:
                        prev, prev_pr = sha_owner[key]
                        if prev_pr != pr:
                            _add_edge(edges, union, prev, index, "identical-patch")
                    else:
                        sha_owner[key] = (index, pr)
                if patch_id:
                    key = (item["project"], patch_id)
                    if key in pid_owner:
                        prev, prev_sha, prev_pr = pid_owner[key]
                        if prev_pr != pr and prev_sha != digest:
                            kind = "backport" if _BACKPORT.search(subject) or _BACKPORT.search(
                                _subject_of(items[prev], prev_pr)
                            ) else "cherry-pick"
                            _add_edge(edges, union, prev, index, kind)
                    else:
                        pid_owner[key] = (index, digest, pr)
    return find, edges


def _subject_of(item: dict, pr: int) -> str:
    for patch in item.get("patches") or []:
        if int(patch.get("pr", -1)) == pr:
            return patch.get("commit_subject") or ""
    return ""


def _add_edge(edges: dict, union, left: int, right: int, reason: str) -> None:
    if left == right:
        return
    union(left, right)
    key = (left, right) if left < right else (right, left)
    edges.setdefault(key, set()).add(reason)


def grouping_codes_ok(codes: list[str]) -> bool:
    return all(code in GROUPING_CODES for code in codes)
