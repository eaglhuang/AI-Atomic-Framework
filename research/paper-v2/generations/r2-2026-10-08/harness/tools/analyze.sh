#!/usr/bin/env bash
# ANALYSIS-ONLY. Rebuilds tables/re-scores from frozen raw cells. Never modifies runs/<cell>/ or any sealed generation.
# Usage: tools/analyze.sh [OUT_DIR]   (default: runs/r2-analysis/<timestamp>; refuses an existing non-empty OUT_DIR)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
export PATH="${NODE_BIN:-/workspace/.nvm/versions/node/v24.21.0/bin}:${PATH:-}"
OUT="${1:-$ROOT/runs/r2-analysis/$(TZ=Asia/Taipei date +%Y%m%d-%H%M%S)}"
if [ -d "$OUT" ] && [ -n "$(ls -A "$OUT")" ]; then echo "refuse: $OUT exists and is not empty" >&2; exit 2; fi
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
echo "== analyze → $OUT (raw read-only) =="
# fingerprint raw inputs before/after to prove read-only
snap(){ find runs -maxdepth 1 -mindepth 1 -type d ! -name 'r2-analysis' -print0 | sort -z | xargs -0 -I{} sh -c 'find "{}" -type f ! -path "*/.git/*" -printf "%P %s %T@\n"' | sha256sum | cut -d' ' -f1; }
B=$(snap)
node test/oracle_v2_contract.mjs "$OUT/oracle-contract" > "$OUT/oracle-contract.log"
node analysis/rescore_oracle_v2.mjs --out="$OUT/oracle-rescore" > "$OUT/oracle-rescore.log"
RESCORE="$OUT/oracle-rescore/rescore_cells.json" OUT="$OUT/e4-forensics" python3 analysis/e4_forensics.py > "$OUT/e4-forensics.log"
python3 analysis/rebuild_tables.py --out "$OUT/tables" --rescore "$OUT/oracle-rescore/rescore_cells.json" > "$OUT/tables.log"
python3 analysis/cell_index.py "$OUT/cell-index" > "$OUT/cell-index.log"
python3 analysis/logical_id_audit.py "$OUT/logical-id-audit" > "$OUT/logical-id-audit.log"
# r1 extractors (E3/E4) re-run in a sandbox copy that writes only under $OUT; output diffed against r1 compare_raw
mkdir -p "$OUT/r1-extractors"
for pair in "e3-sweep/extract_e3.py:e3_compare_raw.json" "e4-multiprocess/extract_e4.py:e4_compare_raw.json"; do
  src="runs/${pair%%:*}"; js="${pair##*:}"; stage="${pair%%/*}"
  dst="$OUT/r1-extractors/$(basename "$src")"
  sed -e "s|^ROOT = .*|ROOT = Path('$ROOT')|" -e "s|^OUT_DIR = .*|OUT_DIR = Path('$OUT/r1-extractors')|" -e "s|^OUT = Path(__file__).*|OUT = Path('$OUT/r1-extractors')|" "$src" > "$dst"
  ( cd "$OUT/r1-extractors" && python3 "$dst" > "$(basename "$src").log" 2>&1 ) || echo "WARN: $src failed (see log)"
  python3 - "$ROOT/runs/$stage/$js" "$OUT/r1-extractors/$js" > "$OUT/r1-extractors/${js%.json}.diff.txt" <<'PY'
import json,sys
a,b=(json.load(open(p)) for p in sys.argv[1:3])
def strip(x):
    if isinstance(x,dict): return {k:strip(v) for k,v in x.items() if not any(t in k for t in ('created','generated','_at'))}
    if isinstance(x,list): return [strip(v) for v in x]
    return x
print('IDENTICAL' if strip(a)==strip(b) else 'DIFFERENT')
PY
done
[ -s runs/e2-matrix/extract_e2.py ] || echo "NOTE: runs/e2-matrix/extract_e2.py is 0 bytes (r1); E2 is rebuilt by analysis/rebuild_tables.py instead" > "$OUT/r1-extractors/E2_NOTE.txt"
A=$(snap)
[ "$B" = "$A" ] && echo "raw unchanged (fingerprint $B)" | tee "$OUT/RAW_READONLY_CHECK.txt" || { echo "ERROR: raw changed during analyze" | tee "$OUT/RAW_READONLY_CHECK.txt"; exit 1; }
cat "$OUT"/r1-extractors/*.diff.txt
echo "done: $OUT"
