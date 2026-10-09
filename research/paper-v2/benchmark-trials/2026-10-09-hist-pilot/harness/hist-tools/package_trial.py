#!/usr/bin/env python3
"""Assemble an immutable HIST trial generation directory (staging) with MANIFEST.json, SHA256SUMS, verify.sh.
usage: package_trial.py BATCH_DIR STAGE_ROOT GEN_NAME PAIRS_FILE [--with-selection]"""
import gzip, hashlib, json, os, shutil, subprocess, sys, time
B, ROOT, GEN, PAIRS = sys.argv[1:5]; WITH_SEL = '--with-selection' in sys.argv
H = '/workspace/reports/atm-v2-harness'; M = '/workspace/scratch/hist/mined'; DATA = '/workspace/scratch/hist/data'
G = os.path.join(ROOT, 'research/paper-v2/benchmark-trials', GEN)
if os.path.exists(G): sys.exit(f'refusing to overwrite existing generation {G}')
os.makedirs(G)
cp = lambda s, d: (os.makedirs(os.path.dirname(os.path.join(G, d)), exist_ok=True), shutil.copy2(s, os.path.join(G, d)))
def cptree(s, d):
    shutil.copytree(s, os.path.join(G, d))
# raw results
cptree(os.path.join(B, 'runs'), 'raw/runs'); cptree(os.path.join(B, 'finals'), 'raw/finals')
for f in ['crosscheck_gold.json', 'index.jsonl', 'batch_meta.json', 'batch_done.json', 'batch.log', 'semantic.json', 'semantic.log', 'summary.json', 'PINS.json']:
    if os.path.exists(os.path.join(B, f)): cp(os.path.join(B, f), ('raw/' if f not in ('summary.json', 'PINS.json') else ('summaries/' if f == 'summary.json' else '')) + f)
cp(os.path.join(B, 'SUMMARY.md'), 'summaries/SUMMARY.md')
for f in ['GENERATION.md', 'DEVIATIONS.md']: cp(os.path.join(B, f), f)
# harness snapshot (exact files used)
for f in ['src/hist/patchkit.mjs', 'src/hist/oracle_hist.mjs', 'src/hist/admit.mjs', 'src/hist/worker.mjs', 'src/hist/run-pair.mjs', 'src/hist/batch.mjs',
          'src/steward-writer.mjs', 'src/real-broker.mjs', 'src/atm-resolve.mjs', 'src/util.mjs', 'src/arms.mjs', 'package.json',
          'test/hist_oracle_contract.mjs', 'hist-tools/mine_search.py', 'hist-tools/build_pairs.py', 'hist-tools/sample_pairs.py',
          'hist-tools/annotate_base_exists.py', 'hist-tools/crosscheck_gold.py', 'hist-tools/semantic.py', 'hist-tools/summarize.py', 'hist-tools/package_trial.py',
          'hist-tools/SELECTION_RULES.md', 'hist-tools/SELECTION_RULES.sha256', 'hist-tools/README.md']:
    cp(os.path.join(H, f), 'harness/' + f)
cp(os.path.join(B, 'contract_test_output.txt'), 'harness/contract_test_output.txt')
# selection data
cp(PAIRS, 'selection/' + os.path.basename(PAIRS))
for f in ['sample.json', 'build_meta.json']: cp(os.path.join(M, f), 'selection/' + f)
if WITH_SEL:
    for f in ['pr_snapshot.jsonl', 'pr_eligibility.jsonl', 'candidates.jsonl']: cp(os.path.join(M, f), 'selection/' + f)
    for f in ['django_pr_search.jsonl', 'django_pr_search.jsonl.log', 'django_pull_heads.txt']: cp(os.path.join(DATA, f), 'selection/' + f)
    with open(os.path.join(M, 'pairs_eligible.jsonl'), 'rb') as fi, open(os.path.join(G, 'selection/pairs_eligible.jsonl.gz'), 'wb') as fo:
        with gzip.GzipFile(fileobj=fo, mode='wb', mtime=0, filename='') as gz: shutil.copyfileobj(fi, gz)
# license / notice for regenerated upstream patches
lic = subprocess.run(['git', '-C', '/workspace/scratch/hist/django-full.git', 'show', 'HEAD:LICENSE'], capture_output=True).stdout
open(os.path.join(G, 'third_party/django/LICENSE'), 'wb').write(lic) if os.makedirs(os.path.join(G, 'third_party/django'), exist_ok=True) is None else None
open(os.path.join(G, 'third_party/django/NOTICE.md'), 'w').write(
    "# Third-party notice: Django\n\nFiles under `selection/` (pair hunks and base texts: `base_text`, `pre`, `post`, context lines) and `raw/finals/`, "
    "`raw/runs/*/final_failing/` contain source code excerpts regenerated from the public Django repository "
    "(https://github.com/django/django) at the commits recorded in each pair (`base`, `writers[].mb`, `writers[].head`).\n"
    "Django is Copyright (c) Django Software Foundation and individual contributors, licensed under the BSD 3-Clause license (copy in `LICENSE`).\n"
    "These excerpts are redistributed unmodified (or as the harness's merge results of unmodified hunks) solely as research evidence. "
    "Pairing method follows STALE (arXiv:2609.25396) by citation only; no STALE data is redistributed.\n")
# verify.sh (same read-only verifier as r1-r5)
shutil.copy2(os.path.join(H, 'tools/verify.sh'), os.path.join(G, 'verify.sh')); os.chmod(os.path.join(G, 'verify.sh'), 0o755)
files = []
for d, _, fs in os.walk(G):
    for f in fs:
        p = os.path.relpath(os.path.join(d, f), G)
        if p == 'SHA256SUMS': continue
        files.append(p)
files.sort()
man = {'schema': 'atm-bench.generation_manifest.v1', 'generation': GEN, 'kind': 'trial-run (試跑), excluded from formal results',
       'sealed_at_cst': time.strftime('%Y-%m-%d %H:%M:%S CST'), 'n_files': len(files) + 1, 'files': []}
tot = 0
for p in files:
    if p == 'MANIFEST.json': continue
    b = open(os.path.join(G, p), 'rb').read(); tot += len(b)
    man['files'].append({'path': p, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
man['total_bytes'] = tot
json.dump(man, open(os.path.join(G, 'MANIFEST.json'), 'w'), indent=1)
files = sorted(set(files) | {'MANIFEST.json'})
with open(os.path.join(G, 'SHA256SUMS'), 'w') as f:
    for p in files: f.write(f"{hashlib.sha256(open(os.path.join(G, p), 'rb').read()).hexdigest()}  {p}\n")
print(G, len(files) + 1, 'files', tot, 'bytes')
