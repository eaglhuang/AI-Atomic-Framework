"""Test purpose, semantic flag, windows, and cluster labels."""

from __future__ import annotations

from datetime import datetime, timezone

from .parameters import DEV_WINDOW, GROUPING_CODES, HELDOUT_WINDOW

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
        return "held-out"
    if not known and explicit in {"dev", "held-out", "dev-cross-window", "cross-window"}:
        return explicit
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


def apply_shared_pr_grouping(items: list) -> None:
    dev_prs: set[tuple[str, int]] = set()
    for item in items:
        if item["set"] == "dev":
            for pr in item["prs"]:
                dev_prs.add((item["project"], pr))
    for item in items:
        if item["set"] not in ("held-out", "cross-window", "held-out-project"):
            continue
        if any((item["project"], pr) in dev_prs for pr in item["prs"]):
            if "shared-pr-with-dev" not in item["grouping_codes"]:
                item["grouping_codes"].append("shared-pr-with-dev")
            item["set"] = "dev-cross-window"


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
        for pr in item["prs"]:
            key = (item["project"], pr)
            if key in owners:
                union(owners[key], index)
            else:
                owners[key] = index
    groups: dict[int, list] = {}
    for index, item in enumerate(items):
        groups.setdefault(find(index), []).append(item)
    for group in groups.values():
        cluster_id = min(item["id"] for item in group)
        for item in group:
            item["cluster_id"] = cluster_id


def grouping_codes_ok(codes: list[str]) -> bool:
    return all(code in GROUPING_CODES for code in codes)
