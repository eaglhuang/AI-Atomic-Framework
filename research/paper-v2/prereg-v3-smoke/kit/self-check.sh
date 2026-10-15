#!/bin/bash
# Quota-free end-to-end check: fixture repo, stub agent, both arms, evaluate, seal.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
test -f "$HERE/../../EVIDENCE_INDEX.md"
grep -q 'INDEX_FILE="$HERE/../../EVIDENCE_INDEX.md"' "$HERE/seal.sh"
export PREREG_SMOKE_MODE=fixture
export PREREG_SMOKE_CODEX="$HERE/bin/stub-codex.mjs"
export PREREG_SMOKE_STATE="$HERE/state-selfcheck"
rm -rf "$PREREG_SMOKE_STATE"
bash "$HERE/setup.sh"
bash "$HERE/run_arm_a.sh"
bash "$HERE/run_arm_b.sh"
bash "$HERE/evaluate.sh"
python3 - << PY
import json
from pathlib import Path
state = Path("$PREREG_SMOKE_STATE")
results = json.loads((state / "results.json").read_text())
a = results["arms"]["A"]
b = results["arms"]["B"]
assert a["startSkewMs"] < 5000, a["startSkewMs"]
assert b["startSkewMs"] < 5000, b["startSkewMs"]
assert a["lostEditCount"] >= 1, a
assert b["lostEditCount"] == 0, b
assert b["steward"]["writes"] >= 2, b["steward"]
assert any(size and size >= 1 for size in b["steward"]["batchSizes"]), b["steward"]
text_a = (state / "arm-a" / "work" / "shared.py").read_text()
text_b = (state / "arm-b" / "work" / "shared.py").read_text()
assert "beta-one" not in text_a and "delta-two" in text_a, text_a
assert "beta-one" in text_b and "delta-two" in text_b, text_b
tests_b = b["tests"]
assert all(item["passed"] >= 1 for item in tests_b), tests_b
print("self-check assertions ok")
print(json.dumps({"A_lost": a["lostEditCount"], "B_lost": b["lostEditCount"], "B_writes": b["steward"]["writes"], "B_latency": b["steward"]["writeToCommitMs"]}, indent=2))
PY
INDEX="$(mktemp)"
DEST="$(mktemp -d)/2026-10-15-codex-stub"
# seal refuses an existing dest; the temp dir is the parent.
rmdir "$(dirname "$DEST")"
bash "$HERE/seal.sh" --index-file "$INDEX" --dest "$DEST" --publish-index
grep -q "smoke / exploratory, not results" "$INDEX"
(cd "$DEST" && sha256sum -c SHA256SUMS)
echo "self-check seal ok: $DEST"
