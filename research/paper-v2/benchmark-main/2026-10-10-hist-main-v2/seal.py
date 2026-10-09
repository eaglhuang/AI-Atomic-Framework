#!/usr/bin/env python3
"""Seal a generation dir: MANIFEST.json (all files except MANIFEST.json/SHA256SUMS), SHA256SUMS (all files except itself), read-only."""
import hashlib, json, os, sys, time, subprocess
G = sys.argv[1]; gen = os.path.basename(G.rstrip('/')); kind = sys.argv[2]
def files():
    out = []
    for root, _, fs in os.walk(G):
        for f in fs:
            p = os.path.relpath(os.path.join(root, f), G)
            if p not in ('MANIFEST.json', 'SHA256SUMS'): out.append(p)
    return sorted(out)
def h(p): return hashlib.sha256(open(os.path.join(G, p), 'rb').read()).hexdigest()
fl = files()
m = {'schema': 'atm-bench.generation_manifest.v1', 'generation': gen, 'kind': kind, 'n_files': len(fl) + 1,
     'sealed_at_cst': time.strftime('%Y-%m-%d %H:%M:%S CST'), 'token_policy': 'no token in any file',
     'files': [{'path': p, 'bytes': os.path.getsize(os.path.join(G, p)), 'sha256': h(p)} for p in fl]}
json.dump(m, open(os.path.join(G, 'MANIFEST.json'), 'w'), indent=1, sort_keys=True)
with open(os.path.join(G, 'SHA256SUMS'), 'w') as f:
    for p in sorted(fl + ['MANIFEST.json']): f.write(f"{h(p)}  {p}\n")
subprocess.run(['chmod', '-R', 'a-w', G], check=True)
print('sealed', len(fl) + 1, 'files')
