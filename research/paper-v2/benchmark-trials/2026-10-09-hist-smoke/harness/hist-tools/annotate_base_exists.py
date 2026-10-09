#!/usr/bin/env python3
"""Adds base_exists {path: bool} to sampled pair files (does not change selection). usage: annotate_base_exists.py repo.git in.jsonl out.jsonl"""
import json, subprocess, sys
G, src, dst = sys.argv[1:4]
with open(dst, 'w') as f:
    for l in open(src):
        p = json.loads(l)
        p['base_exists'] = {path: subprocess.run(['git', '-C', G, 'cat-file', '-e', f"{p['base']}:{path}"]).returncode == 0 for path in p['base_text']}
        f.write(json.dumps(p, sort_keys=True) + '\n')
