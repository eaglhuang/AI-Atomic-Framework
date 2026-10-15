"""Real lost effects, corruption, and inconsistent terminals are counterexamples.

Injected negative controls are labeled and are not counterexamples.
The forensic file is left in place. Callers must not delete it.
"""

import json
from pathlib import Path


class Counterexample(RuntimeError):
    def __init__(self, kind: str, path: Path) -> None:
        super().__init__(f"COUNTEREXAMPLE {kind} preserved at {path}")
        self.kind = kind
        self.path = path


def preserve(run_dir: Path, kind: str, detail: dict) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / "FORENSIC.json"
    payload = {"kind": kind, "injected": False, "detail": detail}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    raise Counterexample(kind, path)


def assert_clean_observation(run_dir: Path, body: str, accepted_ids: list[int], signatures: dict[int, str], status: str) -> None:
    if "<<<<<<<" in body or ">>>>>>>" in body:
        preserve(run_dir, "corruption", {"body": body, "accepted_ids": accepted_ids})
    missing = [proposal_id for proposal_id in accepted_ids if signatures.get(proposal_id) and signatures[proposal_id] not in body]
    if missing:
        preserve(
            run_dir,
            "lost-effect",
            {"missing_proposal_ids": missing, "accepted_ids": accepted_ids, "body": body},
        )
    if status == "inconsistent":
        preserve(run_dir, "inconsistent", {"accepted_ids": accepted_ids, "body": body})
