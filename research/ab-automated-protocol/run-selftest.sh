#!/bin/sh
# Verifies the runner end to end with the fake agent (no API). Expected: identity control -> "no difference".
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT=${AB_OUT:-$(mktemp -d)}
AB_BUDGET_USD=${AB_BUDGET_USD:-1} node "$HERE/run_ab.mjs" run --protocol "$HERE/protocol.json" --out "$OUT"
node "$HERE/run_ab.mjs" report --protocol "$HERE/protocol.json" --out "$OUT" > "$OUT/report.json"
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const v = r.decision.comparisons.identity.verdict;
if (v !== "no difference") { console.error("selftest FAILED: identity verdict = " + v); process.exit(1); }
console.log("selftest ok: identity verdict = " + v + " (" + process.argv[1] + ")");
' "$OUT/report.json"
