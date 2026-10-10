"""Mutually exclusive write-class decision from already materialized sides."""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

from .hunks import min_distance, stratum_for
from .labels import PURPOSES

STRUCTURAL = frozenset({"create", "delete", "rename"})


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


@dataclass
class Decision:
    write_class: str
    stratum: str | None
    min_dist: int | None
    test_purpose_code: str
    test_purpose: str
    correct_answer: dict
    blobs: dict
    notes: list


def decide(base: bytes | None, sides: list[SideView], merger) -> Decision:
    ordered = sorted(sides, key=lambda side: (side.committer_time, side.pr))
    notes: list[str] = []
    if any(side.op in STRUCTURAL for side in ordered):
        return _decision("D", None, None, _safety_answer(), {}, notes)

    clean_sides = [side for side in ordered if not side.transplant_conflict]
    if any(side.transplant_conflict for side in ordered):
        notes.append("transplant-conflict")
        return _conflict_decision(base, clean_sides, merger, notes, stratum=None, min_dist=None)

    groups = [side.hunks for side in ordered]
    distance = min_distance(groups)
    stratum = stratum_for(distance)
    if distance is None:
        notes.append("no-hunk-pairs-treated-as-disjoint")

    fold_results = _fold_all(base if base is not None else b"", ordered, merger)
    if any(rc != 0 for rc, _blob, _order in fold_results):
        return _conflict_decision(base, ordered, merger, notes, stratum, distance)

    unique = {}
    for rc, blob, order in fold_results:
        unique.setdefault(blob, []).append(order)
    if len(unique) > 1:
        return _order_decision(unique, notes, stratum, distance)

    merged = fold_results[0][1]
    if all(side.after == ordered[0].after for side in ordered):
        notes.append("identical-bytes")
        if ordered[0].after == base:
            notes.append("identical-to-base")
        return _bytes_decision("A'", stratum, distance, merged, notes)

    write_class = "A" if distance is None or distance > 3 else "B"
    return _bytes_decision(write_class, stratum, distance, merged, notes)


def _decision(write_class, stratum, min_dist, answer, blobs, notes) -> Decision:
    code, purpose = PURPOSES[write_class]
    return Decision(write_class, stratum, min_dist, code, purpose, answer, blobs, notes)


def _bytes_decision(write_class, stratum, min_dist, blob: bytes, notes) -> Decision:
    key = "full"
    answer = {
        "kind": "git-merge-bytes" if write_class in ("A", "B") else "identical-edits",
        "expected_sha256": _sha(blob),
        "blob_key": key,
        "forbids_mixed_bytes": True,
        "description_zh": _bytes_description(write_class),
    }
    return _decision(write_class, stratum, min_dist, answer, {key: blob}, notes)


def _bytes_description(write_class: str) -> str:
    if write_class == "A'":
        return "兩邊改法位元組相同；期望檔案等於該唯一結果。不併入 A／B／C。"
    if write_class == "B":
        return "所有 proposal 都落地；最終檔案等於 git merge-file 結果，逐位元組相同。"
    return "兩邊效果都保留；最終檔案等於 git merge-file 結果，逐位元組相同。"


def _safety_answer() -> dict:
    return {
        "kind": "write-safety-fail-closed",
        "expected_sha256": None,
        "forbids_mixed_bytes": True,
        "description_zh": "不遺失、不損毀；若被拒絕必須 fail-closed。不比較混合位元組。",
    }


def _order_decision(unique: dict, notes, stratum, min_dist) -> Decision:
    orders = []
    blobs = {}
    for blob, perms in unique.items():
        key = "order-" + "_".join(str(pr) for pr in perms[0])
        blobs[key] = blob
        digest = _sha(blob)
        for perm in perms:
            orders.append({"prs": list(perm), "sha256": digest, "blob_key": key})
    orders.sort(key=lambda row: row["prs"])
    answer = {
        "kind": "order-dependent",
        "expected_sha256": None,
        "orders": orders,
        "forbids_mixed_bytes": True,
        "description_zh": "合併乾淨但順序不同結果不同；各順序分開記錄，不併入 A／B／C。",
    }
    return _decision("B'", stratum, min_dist, answer, blobs, notes)


def _conflict_decision(base, sides, merger, notes, stratum, min_dist) -> Decision:
    allowed = []
    blobs = {}
    indexes = list(range(len(sides)))
    for size in range(1, len(sides) + 1):
        for combo in itertools.combinations(indexes, size):
            if size == len(sides) and any(getattr(side, "transplant_conflict", False) for side in sides):
                continue
            result = _subset_bytes(base if base is not None else b"", sides, combo, merger)
            if result is None:
                continue
            prs = [sides[index].pr for index in combo]
            key = "subset-" + "_".join(str(pr) for pr in prs)
            blobs[key] = result
            allowed.append({"prs": prs, "sha256": _sha(result), "blob_key": key})
    answer = {
        "kind": "one-sided-or-compatible-subset",
        "expected_sha256": None,
        "allowed": allowed,
        "forbids_mixed_bytes": True,
        "description_zh": "只有一方或相容子集可落地；不得寫入混合位元組或衝突標記。",
    }
    return _decision("C", stratum, min_dist, answer, blobs, notes)


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
        if rc != 0:
            # One conflicting order is enough to reject the set; still record it.
            # Continue so a later diagnostic can see sibling orders, but conflicts
            # are not order-dependent clean merges.
            continue
    return folded


def _fold(base: bytes, blobs: list[bytes], order: tuple[int, ...], merger) -> tuple[int, bytes]:
    acc = blobs[order[0]]
    for index in order[1:]:
        rc, acc = merger(acc, base, blobs[index])
        if rc != 0:
            return rc, acc
    return 0, acc


def _sha(blob: bytes) -> str:
    import hashlib

    return hashlib.sha256(blob).hexdigest()
