"""Legal subsets. The key is the sorted unique proposal id. Order is not the key.

A subset is legal only when every git merge-file order is clean and the bytes match.
"""

from itertools import permutations

from .merge import git_merge_file
from .patchutil import PatchApplyError, apply_unified_patch


class Member:
    def __init__(self, proposal_id: int, mine: str, arrived_at: float) -> None:
        self.proposal_id = proposal_id
        self.mine = mine
        self.arrived_at = arrived_at


def set_key(proposal_ids: list[int]) -> list[int]:
    return sorted(set(proposal_ids))


def materialize(base: str, patch: str) -> str:
    return apply_unified_patch(base, patch)


def prove(base: str, members: list[Member]) -> tuple[bool, str | None]:
    if not members:
        return True, base
    texts: list[str] = []
    for order in permutations(members):
        current = base
        for member in order:
            code, merged = git_merge_file(current, base, member.mine)
            if code != 0:
                return False, None
            current = merged
        texts.append(current)
    if any(text != texts[0] for text in texts):
        return False, None
    return True, texts[0]


def select_arrival_maximal(base: str, members: list[Member]) -> tuple[list[Member], str | None]:
    """Greedy by arrival, then proposal id. A member joins only if the subset stays legal."""
    ordered = sorted(members, key=lambda member: (member.arrived_at, member.proposal_id))
    accepted: list[Member] = []
    content: str | None = None
    for member in ordered:
        ok, text = prove(base, accepted + [member])
        if ok and text is not None:
            accepted.append(member)
            content = text
    return accepted, content


def mine_or_none(base: str, patch: str) -> str | None:
    try:
        return materialize(base, patch)
    except PatchApplyError:
        return None
