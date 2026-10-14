"""Synthetic fixtures and the prewritten answer key."""

import json
from pathlib import Path

from .patchutil import patch_create, patch_delete, patch_replace_line
from .paths import harness_root


def catalog_path() -> Path:
    return harness_root() / "fixtures" / "catalog.json"


def load_catalog() -> dict:
    return json.loads(catalog_path().read_text(encoding="utf-8"))


def fixture_by_id(fixture_id: str) -> dict:
    for fixture in load_catalog()["fixtures"]:
        if fixture["id"] == fixture_id:
            return fixture
    raise KeyError(fixture_id)


def build_patch(fixture: dict, proposal: dict) -> str:
    filename = fixture["filename"]
    operation = proposal["operation"]
    if operation == "edit":
        return patch_replace_line(filename, fixture["base"], proposal["line_index"], proposal["replacement"])
    if operation == "create":
        return patch_create(filename, proposal["replacement"] + "\n")
    if operation == "delete":
        return patch_delete(filename, fixture["base"])
    if operation == "rename":
        return ""
    raise KeyError(operation)


def ordered_proposals(fixture: dict, order: str) -> list[dict]:
    proposals = list(fixture["proposals"])
    if order == "reverse":
        proposals.reverse()
    if order not in ("forward", "reverse"):
        raise ValueError(order)
    return proposals
