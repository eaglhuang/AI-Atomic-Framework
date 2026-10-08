#!/usr/bin/env bash
# SEAL a staged generation directory: writes MANIFEST.json and SHA256SUMS (last). Explicit, separate from verify.
# Refuses if the directory is already sealed (generations are immutable — make a new generation instead).
# Usage: tools/seal.sh <staged-generation-dir>
set -euo pipefail
G="${1:?usage: tools/seal.sh <staged-generation-dir>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$G" ] || { echo "no such dir: $G" >&2; exit 2; }
[ -e "$G/SHA256SUMS" ] && { echo "refuse: $G already sealed (SHA256SUMS exists)" >&2; exit 2; }
[ -e "$G/MANIFEST.json" ] && { echo "refuse: $G/MANIFEST.json exists" >&2; exit 2; }
cp "$ROOT/tools/verify.sh" "$G/verify.sh.tmp" && sed -e 's|^G="\${1:?usage: tools/verify.sh <generation-dir>}"|G="${1:-$(dirname "$0")}"|' "$G/verify.sh.tmp" > "$G/verify.sh" && rm "$G/verify.sh.tmp" && chmod +x "$G/verify.sh"
find "$G" -type l | grep -q . && { echo "refuse: symlinks present" >&2; exit 2; }
big=$(find "$G" -type f -size +25M); [ -n "$big" ] && { echo "refuse: files >25MB: $big" >&2; exit 2; }
( cd "$G" && python3 - <<'PY'
import os, hashlib, json, time
files = []
for dp, dn, fn in os.walk('.'):
    for f in fn:
        p = os.path.relpath(os.path.join(dp, f), '.')
        if p in ('SHA256SUMS', 'MANIFEST.json'): continue
        b = open(p, 'rb').read()
        files.append(dict(path=p, bytes=len(b), sha256=hashlib.sha256(b).hexdigest()))
files.sort(key=lambda x: x['path'])
paths = [f['path'] for f in files]
assert len(paths) == len(set(paths))
json.dump(dict(schema='atm-bench.generation_manifest.v1', sealed_at_cst=time.strftime('%Y-%m-%d %H:%M:%S CST'),
    n_files=len(files), total_bytes=sum(f['bytes'] for f in files), files=files), open('MANIFEST.json', 'w'), indent=1)
PY
  find . -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort | while IFS= read -r f; do sha256sum -- "$f"; done > SHA256SUMS )
echo "sealed: $G ($(grep -c . "$G/SHA256SUMS") files)"; "$G/verify.sh" "$G"
