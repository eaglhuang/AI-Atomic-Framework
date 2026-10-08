#!/usr/bin/env bash
# F3 — verify / lightweight rebuild (default). Does NOT re-run 150 E2 cells unless --full / --matrix e2.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="${NODE_BIN:-/workspace/.nvm/versions/node/v24.21.0/bin}:${PATH:-}"
ATM_SHA="5692474f7db70ab52a7a71c8af4867609e7e4b43"
ATM_PATH="${ATM_MONOREPO:-/workspace/atm-main-5692474f/AI-Atomic-Framework-${ATM_SHA}}"
export ATM_MONOREPO="$ATM_PATH"

SKIP_PROBE=0
MATRIX=none   # none | e1 | e2 | verify-only
FULL=0

usage() {
  cat <<'U'
Usage: bash reproduce.sh [--skip-probe] [--matrix none|e1|e2|verify-only] [--full]
  Default: verify-only (check pin + critical files, refresh manifest fingerprint notes + checksums.sha256)
  --skip-probe   do not run composer-probe smoke
  --matrix e1|e2 re-run that matrix script (destructive to those run cells)
  --full         same as --matrix e2
U
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-probe) SKIP_PROBE=1; shift ;;
    --matrix) MATRIX="${2:-none}"; shift 2 ;;
    --full) FULL=1; MATRIX=e2; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done
[[ "$MATRIX" == "verify-only" ]] && MATRIX=none
[[ "$FULL" -eq 1 ]] && MATRIX=e2

fail() { echo "ERROR: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

echo "=== reproduce.sh (verify-first) $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %Z') ==="
echo "BANNER: DRAFT evidence — not a win claim. CI ≠ main experiment."

# --- ATM pin ---
[[ -d "$ATM_PATH" ]] || fail "ATM pin path missing: $ATM_PATH"
[[ -f "$ATM_PATH/packages/core/src/broker/decision.ts" ]] || fail "ATM decision.ts missing under pin"
case "$ATM_PATH" in
  *"$ATM_SHA"*) ok "ATM path embeds sha $ATM_SHA" ;;
  *) fail "ATM_PATH does not embed expected sha $ATM_SHA: $ATM_PATH" ;;
esac
# No .git on unpacked pin — dirty N/A / false
ok "ATM pin present (read-only expected)"

command -v node >/dev/null || fail "node not on PATH (prefer /workspace/.nvm/versions/node/v24.21.0/bin)"
ok "node $(node -v)"

# --- Critical files ---
CRITICAL=(
  VERSION_ANCHORS.md
  METRIC_DEFINITIONS.md
  ARTIFACT_PACK_SPEC.md
  EXPERIMENT_CHECKLIST.md
  src/oracle.mjs
  src/scenario.mjs
  src/cli.mjs
  runs/e1-pilot/E1_SUMMARY.md
  runs/e2-matrix/E2_SUMMARY.md
  runs/e2-matrix/seeds.json
  runs/e2-matrix/SEEDS_REGISTERED.md
  runs/e3-sweep/E3_SUMMARY.md
  runs/e3-sweep/seeds.json
  runs/e3-sweep/SEEDS_REGISTERED.md
  runs/e4-multiprocess/E4_SUMMARY.md
  runs/e4-multiprocess/seeds.json
  runs/e4-multiprocess/SEEDS_REGISTERED.md
  runs/composer-probe/EXPECTED.md
  runs/composer-probe/probe.out
  runs/baselines/D5_SUMMARY.md
)
for f in "${CRITICAL[@]}"; do
  [[ -f "$f" ]] || fail "missing critical file: $f"
done
ok "critical files present (${#CRITICAL[@]})"

# Optional but listed in pack
OPTIONAL=(
  runs/b5-b8/checksums.sha256
  runs/b5-b8/B5_B8_SUMMARY.md
  runs/composer-probe/checksums.sha256
  runs/e1-pilot/run_matrix.sh
  runs/e2-matrix/run_matrix.sh
)
for f in "${OPTIONAL[@]}"; do
  [[ -f "$f" ]] || echo "WARN: optional missing: $f"
done

# --- Refresh artifact_manifest fingerprints (preserve checklist; update hashes/timestamps) ---
ORACLE_SHA=$(sha256sum src/oracle.mjs | awk '{print $1}')
TREE_FP=$( {
  find src -type f -name '*.mjs' | sort | while read -r f; do sha256sum "$f"; done
  for f in VERSION_ANCHORS.md METRIC_DEFINITIONS.md ARTIFACT_PACK_SPEC.md EXPERIMENT_CHECKLIST.md package.json; do
    [[ -f "$f" ]] && sha256sum "$f"
  done
} | sha256sum | awk '{print $1}' )
CREATED=$(TZ=Asia/Taipei date '+%Y-%m-%dT%H:%M:%S%z')
NODE_V=$(node -v)
OS_LINE=$(. /etc/os-release; echo "$PRETTY_NAME")
NPROC=$(nproc)
CPU=$(lscpu 2>/dev/null | awk -F: '/Model name/{gsub(/^[ \t]+/,"",$2); print $2; exit}')

python3 - "$ATM_SHA" "$ATM_PATH" "$TREE_FP" "$ORACLE_SHA" "$CREATED" "$NODE_V" "$OS_LINE" "$CPU" "$NPROC" <<'PY'
import json, sys, os
atm_sha, atm_path, tree_fp, oracle_sha, created, node_v, os_line, cpu, nproc = sys.argv[1:10]
path = "artifact_manifest.json"
base = {}
if os.path.exists(path):
    with open(path) as f:
        base = json.load(f)
base.update({
  "schema": "atm-bench.artifact_manifest.v1",
  "banner": "DRAFT evidence — not a win claim. Paper stays DRAFT. Do not treat E1/E2 tables as final RQ2 wins.",
  "created_at_cst": created,
  "atm_sha": atm_sha,
  "atm_path": atm_path,
  "atm_role": "candidate_pin_read_only",
  "atm_dirty": False,
  "atm_dirty_note": "Unpacked pin tree without .git; treated as immutable read-only artifact. Path name embeds full SHA.",
  "harness_commit_or_tree_id": f"tree:{tree_fp}",
  "harness_tree_id_note": "No harness git repo. Fingerprint = sha256 over sorted (sha256 of each src/*.mjs + VERSION_ANCHORS.md + METRIC_DEFINITIONS.md + ARTIFACT_PACK_SPEC.md + EXPERIMENT_CHECKLIST.md + package.json).",
  "harness_dirty": True,
  "harness_dirty_note": "Harness has no git; dirty=true means live working tree may post-date frozen E1/E2 DRAFT cells.",
  "oracle_sha": oracle_sha,
  "oracle_path": "src/oracle.mjs",
  "oracle_version": base.get("oracle_version", "c3-effect-bytes-v1"),
  "node": node_v,
  "node_path_preferred": "/workspace/.nvm/versions/node/v24.21.0/bin",
  "os": os_line,
  "cpu": cpu,
  "nproc": int(nproc),
  "arch": "x86_64",
  "rq2_main_arm": "steward",
  "rq2_frozen_invoke": "--arm steward --atm-backend real --compose-window-ms 100",
})
base.setdefault("checklist_ids", {
  "completed": ["A1","A2","A4","A5","B1","B2","B3","B4","B5","B6","B7","B8","C1","C2","C3","C4","D1","D2","D3","D4","D5","E1","E2","F3"],
  "optional_open": ["A3"],
  "todo": ["E3","E4","E5","F1","F2"],
  "final_pin": "TBD",
})
base.setdefault("pointers", {})
base["pointers"].update({
  "VERSION_ANCHORS": "VERSION_ANCHORS.md",
  "METRIC_DEFINITIONS": "METRIC_DEFINITIONS.md",
  "ARTIFACT_PACK_SPEC": "ARTIFACT_PACK_SPEC.md",
  "REPRODUCE": "REPRODUCE.md",
  "reproduce_sh": "reproduce.sh",
  "checksums": "checksums.sha256",
  "e1_pilot": "runs/e1-pilot/",
  "e2_matrix": "runs/e2-matrix/",
  "e2_seeds_registered": "runs/e2-matrix/SEEDS_REGISTERED.md",
  "e2_seeds_json": "runs/e2-matrix/seeds.json",
  "composer_probe": "runs/composer-probe/",
  "b5_b8": "runs/b5-b8/",
  "baselines": "runs/baselines/",
  "steward_gaps": "runs/steward-writer/STEWARD_WRITER_GAPS.md",
})
with open(path, "w") as f:
    json.dump(base, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("refreshed artifact_manifest.json")
PY
ok "artifact_manifest.json refreshed (oracle_sha=$ORACLE_SHA tree=$TREE_FP)"

# --- Optional composer-probe smoke (compare existence; do not overwrite historic probe.out by default) ---
if [[ "$SKIP_PROBE" -eq 0 ]]; then
  if [[ -f runs/composer-probe/probe.out && -f runs/composer-probe/EXPECTED.md ]]; then
    ok "composer-probe artifacts present (skip re-exec; use runs/composer-probe/README.md to re-run historic)"
  else
    fail "composer-probe probe.out or EXPECTED.md missing"
  fi
else
  ok "skip-probe"
fi

# --- Optional matrix (explicit only) ---
case "$MATRIX" in
  none) ok "matrix=none (no E1/E2 re-run)" ;;
  e1)
    echo "WARN: re-running E1 matrix (may overwrite e1-* cells); DRAFT banner still applies"
    bash runs/e1-pilot/run_matrix.sh
    ;;
  e2)
    echo "WARN: re-running E2 matrix (150 cells); DRAFT banner still applies; scenario_hash may differ after logical_id decoupling"
    bash runs/e2-matrix/run_matrix.sh
    ;;
  *) fail "bad --matrix $MATRIX" ;;
esac

# --- Top-level checksums ---
HASH_LIST=(
  VERSION_ANCHORS.md
  METRIC_DEFINITIONS.md
  ARTIFACT_PACK_SPEC.md
  artifact_manifest.json
  REPRODUCE.md
  reproduce.sh
  EXPERIMENT_CHECKLIST.md
  runs/e1-pilot/E1_SUMMARY.md
  runs/e2-matrix/E2_SUMMARY.md
  runs/e2-matrix/seeds.json
  runs/e2-matrix/SEEDS_REGISTERED.md
  runs/e3-sweep/E3_SUMMARY.md
  runs/e3-sweep/seeds.json
  runs/e3-sweep/SEEDS_REGISTERED.md
  runs/e4-multiprocess/E4_SUMMARY.md
  runs/e4-multiprocess/seeds.json
  runs/e4-multiprocess/SEEDS_REGISTERED.md
  runs/composer-probe/EXPECTED.md
  runs/composer-probe/probe.out
  src/oracle.mjs
  src/scenario.mjs
)
# include b5-b8 checksums file if present
[[ -f runs/b5-b8/checksums.sha256 ]] && HASH_LIST+=(runs/b5-b8/checksums.sha256)
[[ -f runs/composer-probe/checksums.sha256 ]] && HASH_LIST+=(runs/composer-probe/checksums.sha256)
[[ -f runs/baselines/D5_SUMMARY.md ]] && HASH_LIST+=(runs/baselines/D5_SUMMARY.md)
[[ -f runs/steward-writer/STEWARD_WRITER_GAPS.md ]] && HASH_LIST+=(runs/steward-writer/STEWARD_WRITER_GAPS.md)

: > checksums.sha256
for f in "${HASH_LIST[@]}"; do
  [[ -f "$f" ]] || fail "cannot hash missing: $f"
  sha256sum "$f" >> checksums.sha256
done
ok "wrote checksums.sha256 ($(wc -l < checksums.sha256) entries)"

echo "=== reproduce.sh DONE (exit 0) — DRAFT evidence pack refreshed ==="
