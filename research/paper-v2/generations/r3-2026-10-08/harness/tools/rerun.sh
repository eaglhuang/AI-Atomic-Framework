#!/usr/bin/env bash
# RERUN into NEW run ids only. Never overwrites existing cells (no --force on existing dirs; refuses collisions).
# Usage:
#   tools/rerun.sh cell <new-run-id> <cli subcommand> [cli args...]     e.g. tools/rerun.sh cell rr-x-1 run-mp --seed 17 ...
#   tools/rerun.sh e4-forensics                                          (r2 P0-1 replays; ids r2f-*)
#   tools/rerun.sh matrix <e1|e2|e3|e4|e5> <TAG>                          (stage matrix with every rid prefixed "rr<TAG>-")
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
export PATH="${NODE_BIN:-/workspace/.nvm/versions/node/v24.21.0/bin}:${PATH:-}"
export ATM_MONOREPO="${ATM_MONOREPO:-/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43}"
case "${1:-}" in
  cell)
    rid="${2:?run id}"; shift 2
    [ -e "runs/$rid" ] && { echo "refuse: runs/$rid exists" >&2; exit 2; }
    node src/cli.mjs "$1" --run-id "$rid" "${@:2}" ;;
  e4-forensics)
    ls -d runs/r2f-e4-* >/dev/null 2>&1 && { echo "refuse: runs/r2f-e4-* already exist (r2 evidence); move them or use 'cell'" >&2; exit 2; }
    bash runs/r2-e4-forensics/run_forensics.sh ;;
  matrix)
    st="${2:?stage}"; tag="${3:?tag}"
    case "$st" in e1) s=runs/e1-pilot/run_matrix.sh;; e2) s=runs/e2-matrix/run_matrix.sh;; e3) s=runs/e3-sweep/run_sweep.sh;;
      e4) s=runs/e4-multiprocess/run_matrix.sh;; e5) s=runs/e5-fault/run_matrix.sh;; *) echo "bad stage" >&2; exit 2;; esac
    out="runs/rerun-$tag-$st"; [ -e "$out" ] && { echo "refuse: $out exists" >&2; exit 2; }
    ls -d runs/rr$tag-* >/dev/null 2>&1 && { echo "refuse: runs/rr$tag-* exist" >&2; exit 2; }
    mkdir -p "$out"
    sed -e "s|rid=\"|rid=\"rr$tag-|g" -e "s|^LOG=.*|LOG=\"\$ROOT/$out/matrix.log\"|" -e "s|^ROOT=.*|ROOT=\"$ROOT\"|" "$s" > "$out/$(basename "$s")"
    echo "rerun script: $out/$(basename "$s") (all rids prefixed rr$tag-)"; bash "$out/$(basename "$s")" ;;
  *) sed -n 2,8p "$0"; exit 2 ;;
esac
