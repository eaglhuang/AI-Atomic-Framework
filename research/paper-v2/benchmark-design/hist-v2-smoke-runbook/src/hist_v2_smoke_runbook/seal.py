"""Seal one trial directory. An existing directory is left untouched."""

import json
import os
from pathlib import Path

from .negative_controls import collect_negative_controls
from .pins import runbook_root
from .preflight import sha256_file
from .stop_report import counterexamples_from, render_stop_report


class OverwriteRefused(FileExistsError):
    pass


def seal_generation(
    dest: Path,
    *,
    date: str,
    pins: dict,
    sample: dict,
    plan: dict,
    observations: list[dict],
    deviations: list[str] | None = None,
    negative: dict | None = None,
    stage_raw=None,
) -> int:
    if dest.exists() and any(dest.iterdir()):
        raise OverwriteRefused(dest)
    dest.mkdir(parents=True, exist_ok=True)
    if stage_raw is not None:
        stage_raw(dest)
    banner = pins["trial_banner"]
    deviations = list(deviations or [])
    if negative is None:
        negative = collect_negative_controls()
    counterexamples = counterexamples_from(observations)
    if negative and not negative.get("all_caught"):
        counterexamples.append(
            {
                "kind": "negative-control-missed",
                "injected": True,
                "path": "forensics/negative-controls.json",
                "detail": negative,
            }
        )
    _write_forensics(dest, counterexamples, observations)
    payload = {
        "GENERATION.md": _generation(banner, date, sample, plan, counterexamples),
        "STOP_REPORT.md": render_stop_report(
            banner=banner,
            date=date,
            plan=plan,
            sample=sample,
            observations=observations,
            negative=negative,
            counterexamples=counterexamples,
            deviations=deviations,
        ),
        "plan.json": _json(plan),
        "observations.jsonl": _jsonl(observations),
        "negative-controls.json": _json(negative),
        "pins-observed.json": _json(
            {
                "trial_only": True,
                "formal_run": False,
                "claims_benchmark_wins": False,
                "core_merge_sha": pins["core_merge_sha"],
                "classifier_rules_sha256": pins["classifier_rules_sha256"],
                "harness_sha256sums_sha256": pins["harness_sha256sums_sha256"],
                "prereg_sha256sums_sha256": pins["prereg_sha256sums_sha256"],
            }
        ),
        "verify.sh": (runbook_root() / "verify.sh").read_text(encoding="utf-8"),
    }
    for name, text in payload.items():
        path = dest / name
        path.write_text(text, encoding="utf-8")
        if name == "verify.sh":
            os.chmod(path, 0o555)
    manifest = {
        "schema": "hist-v2-smoke-manifest/1",
        "trial_only": True,
        "formal_run": False,
        "claims_benchmark_wins": False,
        "date": date,
        "files": _file_rows(dest, skip={"MANIFEST.json", "SHA256SUMS"}),
    }
    (dest / "MANIFEST.json").write_text(_json(manifest), encoding="utf-8")
    rows = _file_rows(dest, skip={"SHA256SUMS"})
    lines = [f"{row['sha256']}  {row['path']}\n" for row in rows]
    (dest / "SHA256SUMS").write_text("".join(lines), encoding="utf-8")
    if counterexamples:
        return 6
    return 0


def _write_forensics(dest: Path, counterexamples: list[dict], observations: list[dict]) -> None:
    if not counterexamples:
        return
    folder = dest / "forensics"
    folder.mkdir(parents=True, exist_ok=True)
    for row in counterexamples:
        path = dest / str(row["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        detail = {
            "kind": row["kind"],
            "injected": bool(row.get("injected")),
            "preserved": True,
            "overwrite": False,
            "item_id": row.get("item_id"),
            "arm": row.get("arm"),
            "detail": row.get("detail") or {},
        }
        index = row.get("observation_index")
        if isinstance(index, int) and 0 <= index < len(observations):
            detail["observation"] = observations[index]
        path.write_text(_json(detail), encoding="utf-8")
    summary = {
        "preserved": True,
        "overwrite": False,
        "counterexamples": counterexamples,
    }
    (dest / "FORENSIC.json").write_text(_json(summary), encoding="utf-8")


def _generation(banner: str, date: str, sample: dict, plan: dict, counterexamples: list[dict]) -> str:
    missing = "、".join(sample.get("missing_classes") or []) or "無"
    return (
        f"{banner}\n\n"
        f"日期：{date}。這是 trial-only 封存，不得作為論文結果。\n"
        f"抽中 {len(sample.get('selected', []))} 題。缺的類別：{missing}。\n"
        f"計畫格子 {plan.get('cell_count', 0)}。已執行格子 {sum(1 for cell in plan.get('cells') or [] if cell.get('executed'))}。\n"
        f"counterexample 數：{len(counterexamples)}。有鑑識時保留原檔，不覆蓋。\n"
        "沒有勝出主張。\n"
    )


def _file_rows(dest: Path, *, skip: set[str]) -> list[dict]:
    rows = []
    for path in sorted(dest.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(dest).as_posix()
        if rel in skip:
            continue
        rows.append({"path": rel, "bytes": path.stat().st_size, "sha256": sha256_file(path)})
    return rows


def _json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _jsonl(rows: list[dict]) -> str:
    return "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)
