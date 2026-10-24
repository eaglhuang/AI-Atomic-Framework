#!/usr/bin/env bash
set -euo pipefail
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"
export PATH="$HOME/.local/node24-latest/bin:$HOME/.local/node22/bin:$HOME/.local/bin:$PATH"
export PYTHONDONTWRITEBYTECODE=1
export TMPDIR="$REPO/n0/t"
export PREREG_ATM_CLI="$REPO/.worklogs/public-cli/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs"
export PREREG_PYTHON="$REPO/n0/validation-venv/bin/python"
KIT=research/paper-v2/prereg-v3-kits/cli-0.1.22-v14-367
DATA=research/paper-v2/prereg-v3-datasets/2026-10-24-six-pairs
GEN=research/paper-v2/prereg-v3-smoke/2026-10-24-v14-three-arm
mkdir -p "$GEN/logs"
python3 "$KIT/bin/verify-kit.py" --dataset "$DATA" > "$GEN/logs/verify.log" 2>&1
python3 "$KIT/test/test-runtime.py" > "$GEN/logs/runtime-regressions.log" 2>&1
python3 "$KIT/test/test-containment.py" > "$GEN/logs/containment-regressions.log" 2>&1
python3 "$KIT/test/test-original-intent.py" > "$GEN/logs/original-intent.log" 2>&1
node "$KIT/bin/generate-unified-patch.mjs" --check > "$GEN/logs/generator-check.log" 2>&1
for ARM in A B B-wt; do
  SCRATCH="$REPO/n0/m14-${ARM}"
  test ! -e "$SCRATCH"
  date -Ins > "$GEN/logs/$ARM.started-at"
  RC=0
  python3 "$KIT/bin/launch.py" --dataset "$DATA" --group g05 --mirror "$REPO/n0/django-full.git" --python "$PREREG_PYTHON" --scratch "$SCRATCH" --arm "$ARM" > "$GEN/logs/$ARM.log" 2>&1 || RC=$?
  date -Ins > "$GEN/logs/$ARM.ended-at"
  printf '%s\n' "$RC" > "$GEN/logs/$ARM.exit-code"
  python3 - "$SCRATCH" "$GEN/run/$ARM" <<'PY'
import json,os,shutil,sys
from pathlib import Path
src=Path(sys.argv[1]);dst=Path(sys.argv[2]);dst.mkdir(parents=True,exist_ok=False)
def copy(p,relative=None):
 if p.is_file():
  target=dst/(relative or p.relative_to(src));target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
for name in ['result.json','steward.log','branch-1.json','branch-2.json']:copy(src/name)
for pattern in ['session-*','resolver-*']:
 for d in src.glob(pattern):
  if not d.is_dir():continue
  for name in ['stdout.jsonl','stderr.txt','prompt.txt','launch.json','session.json']:copy(d/name)
# Snapshot exports only; exclude indexes, credential homes, live repositories and Python caches.
for p in src.rglob('snapshot.json'):
 if any(part in {'work','template','private-1','private-2','submitted-1','submitted-2'} for part in p.relative_to(src).parts):continue
 copy(p);copy(p.parent/'source.bundle')
for d in src.glob('oracle-*'):
 for p in d.rglob('*'):
  if p.is_file() and 'work' not in p.relative_to(d).parts and p.suffix in {'.log','.json','.xml'}:copy(p)
for p in src.glob('resolver-public-*.log'):copy(p)
for name in ['steward-writes.jsonl','session-seen.jsonl']:
 copy(src/'work/.prereg-smoke'/name,Path('steward')/name)
for name in ['live-write-journal.jsonl','live-write-anchors.jsonl']:
 copy(src/'work/.atm/runtime'/name,Path('steward')/name)
for p in (src/'work/.prereg-smoke/inbox').glob('*.json'):copy(p,Path('proposals')/p.name)
secret=os.environ.get('GH_ATM_PUSH_TOKEN','').encode()
for p in dst.rglob('*'):
 if p.is_file() and p.suffix!='.bundle':
  data=p.read_bytes()
  if secret and secret in data:raise RuntimeError('credential scan failed at '+str(p))
if not (dst/'result.json').exists():
 (dst/'operator-invalid.json').write_text(json.dumps({'validity':'INVALID','kitErrors':['launcher did not emit result'],'measurements':None},indent=2)+'\n')
PY
  if [ "$RC" -ne 0 ]; then
    echo "STOP: $ARM invalid or launcher failure; inspect retained logs."
    exit "$RC"
  fi
  python3 - "$SCRATCH/result.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert not r.get('quotaStop'),'quota stop; do not continue'
PY
done
echo 'THREE-ARM-SMOKE-COMPLETE'
