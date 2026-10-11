"""Mutually exclusive write-class decision from already materialized sides.

Outcomes are separate: a clean merge, a true concurrency conflict, a
tool-execution error, and a transplant failure are not the same result.
A non-zero merge-file status that is not a conflict count must not become
class C.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

from .hunks import min_distance, stratum_for
from .labels import PURPOSES
from .score import legal_set_key

STRUCTURAL = frozenset({"create", "delete", "rename"})
TEXTUAL_MERGE_NOTE = (
    "與 git merge-file 逐位元組相同只表示符合該文字合併標準，不表示語意上較優。"
)
SCORING = {
    "safety": "已接受集合 S 必須列在合法子集裡，觀察位元組必須等於該子集的參考 R(S)，並且有期限內的 ack。假確認、S 不合法、或位元組不符都是安全失敗。",
    "progress": "進度只問 S 是不是極大合法子集。接受合法但非極大的子集是進度不足，不是安全失敗。仍有合法子集時全部拒絕是進度成本。",
    "false_accept_is_safety_failure": True,
    "unnecessary_reject_is_progress_cost": True,
    "legal_non_maximal_is_progress_shortfall_not_safety_failure": True,
    "b_rejected_by_atm_is_progress_not_class_c": True,
}


class MergeToolError(Exception):
    """merge-file (or a substitute) failed for a reason other than a conflict."""


@dataclass
class SideView:
    pr: int
    mb: str
    head: str
    selected_mb: str
    selected_head: str
    patch_source: str
    op: str
    committer_time: str
    merged_at: str | None
    after: bytes | None
    hunks: list
    gold_test_ids: list
    base_validity: str | None
    transplant_conflict: bool
    code_patch_sha256: str
    notes: list = field(default_factory=list)
    patch_id: str = ""
    commit_subject: str = ""
    has_patch_bytes: bool = False


@dataclass
class Decision:
    write_class: str | None
    stratum: str | None
    min_dist: int | None
    test_purpose_code: str
    test_purpose: str
    correct_answer: dict
    blobs: dict
    notes: list
    outcome: str
    labels: list


def decide(base: bytes | None, sides: list[SideView], merger) -> Decision:
    ordered = sorted(sides, key=lambda side: (side.committer_time, side.pr))
    notes: list[str] = []
    labels: list[str] = []
    if any(side.transplant_conflict for side in ordered):
        labels.append("transplant-conflict")
        notes.append("transplant-conflict")
    try:
        return _decide(base, ordered, merger, notes, labels)
    except MergeToolError as exc:
        notes.append(f"tool-execution-error:{exc}")
        return _tool_decision(notes, labels)


def _decide(base, ordered, merger, notes, labels) -> Decision:
    if any(side.op in STRUCTURAL for side in ordered):
        return _decision("D", None, None, _safety_answer(_sha(b"" if base is None else base)), {}, notes, "structural", labels)

    placeable = [side for side in ordered if not side.transplant_conflict]
    if len(placeable) < 2:
        return _transplant_only(base, placeable, notes, labels)

    groups = [side.hunks for side in placeable]
    distance = min_distance(groups)
    stratum = stratum_for(distance)
    if distance is None:
        notes.append("no-hunk-pairs-treated-as-disjoint")

    fold_results = _fold_all(base if base is not None else b"", placeable, merger)
    if any(rc != 0 for rc, _blob, _order in fold_results):
        return _conflict_decision(base, placeable, merger, notes, stratum, distance, labels)

    unique = {}
    for rc, blob, order in fold_results:
        unique.setdefault(blob, []).append(order)
    if len(unique) > 1:
        allowed, subset_blobs, base_sha = _enumerate_legal(base, placeable, merger)
        return _order_decision(unique, allowed, subset_blobs, base_sha, notes, stratum, distance, labels)

    merged = fold_results[0][1]
    allowed, subset_blobs, base_sha = _enumerate_legal(base, placeable, merger)
    if all(side.after == placeable[0].after for side in placeable):
        notes.append("identical-bytes")
        if placeable[0].after == base:
            notes.append("identical-to-base")
        return _bytes_decision("A'", stratum, distance, merged, allowed, subset_blobs, base_sha, notes, labels)

    write_class = "A" if distance is None or distance > 3 else "B"
    return _bytes_decision(write_class, stratum, distance, merged, allowed, subset_blobs, base_sha, notes, labels)


def _decision(write_class, stratum, min_dist, answer, blobs, notes, outcome, labels) -> Decision:
    if write_class is None:
        code, purpose = (
            "transplant-conflict",
            "移植衝突：單邊補丁無法落到共同 base，不是並發衝突，不標成 C。",
        )
    else:
        code, purpose = PURPOSES[write_class]
    return Decision(
        write_class,
        stratum,
        min_dist,
        code,
        purpose,
        answer,
        blobs,
        notes,
        outcome,
        list(labels),
    )


def _bytes_decision(write_class, stratum, min_dist, blob: bytes, allowed, subset_blobs, base_sha, notes, labels) -> Decision:
    key = "full"
    answer = {
        "kind": "git-merge-bytes" if write_class in ("A", "B") else "identical-edits",
        "expected_sha256": _sha(blob),
        "blob_key": key,
        "allowed": allowed,
        "unchanged_base_sha256": base_sha,
        "forbids_mixed_bytes": True,
        "full_reject_allowed": False,
        "textual_merge_standard_note_zh": TEXTUAL_MERGE_NOTE,
        "scoring": dict(SCORING),
        "description_zh": _bytes_description(write_class),
    }
    blobs = {key: blob}
    blobs.update(subset_blobs)
    return _decision(write_class, stratum, min_dist, answer, blobs, notes, "mergeable", labels)


def _bytes_description(write_class: str) -> str:
    if write_class == "A'":
        return "兩邊改法位元組相同；期望檔案等於該唯一結果。不併入 A／B／C。"
    if write_class == "B":
        return (
            "所有可落地的 proposal 都落地；最終檔案等於 git merge-file 結果。"
            "這只證明符合該文字合併標準。ATM 若拒絕此題，計進度成本，不得改標成 C。"
        )
    return "可落地的 proposal 效果都保留；最終檔案等於 git merge-file 結果，逐位元組相同只表示符合文字合併標準。"


def _safety_answer(base_sha: str) -> dict:
    return {
        "kind": "write-safety-fail-closed",
        "expected_sha256": None,
        "allowed": [],
        "unchanged_base_sha256": base_sha,
        "forbids_mixed_bytes": True,
        "full_reject_allowed": True,
        "scoring": dict(SCORING),
        "description_zh": "不遺失、不損毀；沒有合法的混合子集。全部拒絕且 base 不變才是安全結果。不比較混合位元組。",
    }


def _order_decision(unique: dict, allowed, subset_blobs, base_sha, notes, stratum, min_dist, labels) -> Decision:
    orders = []
    blobs = {}
    for blob, perms in unique.items():
        key = "order-" + "_".join(str(pr) for pr in perms[0])
        blobs[key] = blob
        digest = _sha(blob)
        for perm in perms:
            orders.append(
                {
                    "set_key": list(legal_set_key(perm)),
                    "order": list(perm),
                    "prs": list(perm),
                    "sha256": digest,
                    "blob_key": key,
                }
            )
    orders.sort(key=lambda row: row["prs"])
    answer = {
        "kind": "order-dependent",
        "expected_sha256": None,
        "orders": orders,
        "allowed": allowed,
        "unchanged_base_sha256": base_sha,
        "forbids_mixed_bytes": True,
        "full_reject_allowed": len(allowed) == 0,
        "textual_merge_standard_note_zh": TEXTUAL_MERGE_NOTE,
        "scoring": dict(SCORING),
        "description_zh": "合併乾淨但順序不同結果不同；各順序分開記錄，不併入 A／B／C。",
    }
    blobs.update(subset_blobs)
    return _decision("B'", stratum, min_dist, answer, blobs, notes, "order-dependent", labels)


def _conflict_decision(base, sides, merger, notes, stratum, min_dist, labels) -> Decision:
    allowed, blobs, base_sha = _enumerate_legal(base, sides, merger)
    full_reject = len(allowed) == 0
    answer = {
        "kind": "legal-subsets",
        "expected_sha256": base_sha if full_reject else None,
        "allowed": allowed,
        "full_reject_allowed": full_reject,
        "unchanged_base_sha256": base_sha,
        "forbids_mixed_bytes": True,
        "textual_merge_standard_note_zh": TEXTUAL_MERGE_NOTE,
        "scoring": dict(SCORING),
        "description_zh": (
            "允許結果列出每一個合法子集，並用 maximal 標出極大子集。"
            "每個子集都帶自己的參考位元組 R(S)。"
            "只有不存在任何合法子集時，才允許全部拒絕並保持 base 不變。"
            "接受合法但非極大的子集是進度不足，不是安全失敗。"
            "B 被 ATM 拒絕仍是進度成本，不得改標成 C。"
        ),
    }
    return _decision("C", stratum, min_dist, answer, blobs, notes, "true-conflict", labels)


def _enumerate_legal(base, sides, merger):
    """Every non-empty subset with one order-independent clean merge, plus whether it is maximal."""
    base_bytes = b"" if base is None else base
    compatible: list[tuple[tuple[int, ...], bytes]] = []
    indexes = list(range(len(sides)))
    for size in range(1, len(sides) + 1):
        for combo in itertools.combinations(indexes, size):
            result = _subset_bytes(base_bytes, sides, combo, merger)
            if result is None:
                continue
            compatible.append((combo, result))
    chosen_sets = [set(combo) for combo, _blob in compatible]
    blobs = {}
    allowed = []
    for combo, result in compatible:
        prs = list(legal_set_key(sides[index].pr for index in combo))
        key = "subset-" + "_".join(str(pr) for pr in prs)
        blobs[key] = result
        allowed.append(
            {
                "set_key": prs,
                "order": None,
                "prs": prs,
                "sha256": _sha(result),
                "blob_key": key,
                "maximal": not any(set(combo) < other for other in chosen_sets),
            }
        )
    allowed.sort(key=lambda row: (len(row["prs"]), row["prs"]))
    return allowed, blobs, _sha(base_bytes)


def _transplant_only(base, placeable: list[SideView], notes, labels) -> Decision:
    """Fewer than two proposals survived solo placement. Not class C."""
    blobs = {}
    allowed = []
    for side in placeable:
        if side.after is None:
            continue
        canonical = list(legal_set_key([side.pr]))
        key = "subset-" + "_".join(str(pr) for pr in canonical)
        blobs[key] = side.after
        allowed.append(
            {
                "set_key": canonical,
                "order": None,
                "prs": canonical,
                "sha256": _sha(side.after),
                "blob_key": key,
                "maximal": True,
            }
        )
    base_bytes = b"" if base is None else base
    full_reject = len(allowed) == 0
    answer = {
        "kind": "transplant-conflict",
        "expected_sha256": _sha(base_bytes) if full_reject else None,
        "allowed": allowed,
        "full_reject_allowed": full_reject,
        "unchanged_base_sha256": _sha(base_bytes),
        "forbids_mixed_bytes": True,
        "textual_merge_standard_note_zh": TEXTUAL_MERGE_NOTE,
        "scoring": dict(SCORING),
        "description_zh": (
            "至少一個 proposal 無法單獨移植到共同 base。"
            "這是移植衝突，不是兩個可落地提案之間的並發衝突，不標成 C。"
            "全部拒絕且 base 不變，只在沒有任何可落地的完整 proposal 時才允許。"
        ),
    }
    return _decision(None, None, None, answer, blobs, notes, "transplant-conflict", labels)


def _tool_decision(notes, labels) -> Decision:
    answer = {
        "kind": "tool-execution-error",
        "expected_sha256": None,
        "allowed": [],
        "full_reject_allowed": False,
        "forbids_mixed_bytes": True,
        "description_zh": "合併工具非衝突的非零結束。不得標成 C，呼叫端應技術排除。",
    }
    return _decision(None, None, None, answer, {}, notes, "tool-execution-error", labels)


def _subset_bytes(base: bytes, sides: list[SideView], combo: tuple[int, ...], merger):
    chosen = [sides[index] for index in combo]
    if any(side.transplant_conflict or side.after is None for side in chosen):
        return None
    if len(chosen) == 1:
        return chosen[0].after
    results = _fold_all(base, chosen, merger)
    if any(rc != 0 for rc, _blob, _order in results):
        return None
    blobs = {blob for _rc, blob, _order in results}
    if len(blobs) != 1:
        return None
    return results[0][1]


def _fold_all(base: bytes, sides: list[SideView], merger):
    blobs = [b"" if side.after is None else side.after for side in sides]
    folded = []
    for perm in itertools.permutations(range(len(sides))):
        rc, blob = _fold(base, blobs, perm, merger)
        folded.append((rc, blob, tuple(sides[index].pr for index in perm)))
    return folded


def _fold(base: bytes, blobs: list[bytes], order: tuple[int, ...], merger) -> tuple[int, bytes]:
    acc = blobs[order[0]]
    for index in order[1:]:
        rc, acc = merger(acc, base, blobs[index])
        if is_tool_error(rc):
            raise MergeToolError(f"merge tool rc={rc}")
        if rc != 0:
            return rc, acc
    return 0, acc


def is_tool_error(rc: int) -> bool:
    """Conflict counts are 1..127. Anything else non-zero is not a conflict."""
    return rc < 0 or rc >= 128


def _sha(blob: bytes) -> str:
    import hashlib

    return hashlib.sha256(blob).hexdigest()
