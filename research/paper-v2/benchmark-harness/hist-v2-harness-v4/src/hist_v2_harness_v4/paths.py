"""Repository and classifier locations. Nothing here writes the sealed prereg."""

import os
from pathlib import Path


def repo_root() -> Path:
    env = os.environ.get("HIST_V2_REPO_ROOT")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "atm.mjs").is_file():
            return parent
    raise RuntimeError("ATM repository root was not found")


def harness_root() -> Path:
    return Path(__file__).resolve().parents[2]


def classifier_src() -> Path:
    return repo_root() / "research/paper-v2/benchmark-design/hist-v2-classifier-v8/src"


def classifier_rules() -> Path:
    return classifier_src().parent / "RULES.sha256"


def node_dir() -> Path:
    return harness_root() / "node"


def python_env() -> dict[str, str]:
    env = os.environ.copy()
    parts = [str(harness_root() / "src"), str(classifier_src())]
    extra = env.get("HIST_V2_PYTHONPATH")
    if extra:
        parts.append(extra)
    if env.get("PYTHONPATH"):
        parts.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(parts)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["HIST_V2_REPO_ROOT"] = str(repo_root())
    return env
