"""Pick a deterministic dev-set subset. Held-out rows are refused, not sampled."""

import json
from pathlib import Path


def load_items(path: Path) -> tuple[list[dict], list[str]]:
    items = []
    errors = []
    text = path.read_text(encoding="utf-8")
    for index, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"line {index}: invalid json ({exc.msg})")
            continue
        if not isinstance(item, dict):
            errors.append(f"line {index}: item is not an object")
            continue
        items.append(item)
    return items, errors


def sample_dev(items: list[dict], pins: dict) -> dict:
    errors: list[str] = []
    refused: list[dict] = []
    skipped: list[str] = []
    eligible: list[dict] = []
    expected_rules = pins["classifier_rules_sha256"]
    schema = pins["item_schema_version"]
    for index, item in enumerate(items, start=1):
        if item.get("schema_version") != schema:
            errors.append(f"line {index}: schema_version")
            continue
        if item.get("rules_sha256") != expected_rules:
            errors.append(f"line {index}: rules_sha256")
            continue
        project = str(item.get("project") or "")
        split = str(item.get("set") or "")
        if _forbidden_project(project, pins["forbidden_projects"]) or split in pins["forbidden_sets"]:
            refused.append({"id": item.get("id"), "project": project, "set": split})
            continue
        if split != pins["dev_set"] or item.get("write_class") not in pins["write_classes"]:
            skipped.append(str(item.get("id") or f"line-{index}"))
            continue
        if not item.get("id"):
            errors.append(f"line {index}: missing id")
            continue
        eligible.append(item)
    selected: list[dict] = []
    missing: list[str] = []
    if not errors:
        for write_class in pins["write_classes"]:
            rows = [item for item in eligible if item["write_class"] == write_class]
            if not rows:
                missing.append(write_class)
                continue
            rows.sort(key=lambda item: (str(item["project"]), str(item["id"])))
            selected.append(_public_item(rows[0]))
    return {
        "selected": [] if errors else selected,
        "missing_classes": missing if not errors else list(pins["write_classes"]),
        "refused": refused,
        "skipped": skipped,
        "eligible_count": 0 if errors else len(eligible),
        "errors": errors,
    }


def _public_item(item: dict) -> dict:
    return {
        "id": item["id"],
        "project": item["project"],
        "set": item["set"],
        "write_class": item["write_class"],
        "target_file": item.get("target_file"),
        "rules_sha256": item["rules_sha256"],
    }


def _forbidden_project(project: str, forbidden: list[str]) -> bool:
    normalized = project.strip().lower()
    base = normalized.split("/")[-1]
    blocked = {name.lower() for name in forbidden}
    return normalized in blocked or base in blocked
