#!/usr/bin/env python3
"""Read-only generation verification; never regenerates checksums."""
import argparse,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--dataset',required=True,type=Path);a=p.parse_args();kit=Path(__file__).resolve().parents[1]
for root in [kit,a.dataset]:
 for line in (root/'SHA256SUMS').read_text().splitlines():
  expected,name=line.split('  ',1);target=(root/name).resolve();assert target.is_relative_to(root.resolve());assert hashlib.sha256(target.read_bytes()).hexdigest()==expected,(root,name)
m=json.loads((kit/'MANIFEST.json').read_text());assert hashlib.sha256((a.dataset/'SHA256SUMS').read_bytes()).hexdigest()==m['datasetChecksumsSha256']
d=json.loads((a.dataset/'inventory.json').read_text());ids=[t['instance_id'] for g in d['groups'] for t in g['tasks']];assert len(ids)==12 and len(set(ids))==12;assert sum(g['split']=='main' for g in d['groups'])==4;assert sum(g['split']=='held-out' for g in d['groups'])==2
assert m['cliVersion']=='0.1.22' and m['arms']==['A','B','B-wt'];print('PASS: kit and dataset checksums, pins, six distinct pairs, four main/two held-out')
