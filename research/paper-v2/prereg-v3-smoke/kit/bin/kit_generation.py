#!/usr/bin/env python3
"""Immutable, content-addressed kit generation manifest (never a run re-score)."""
import hashlib
import json
import os
from pathlib import Path
import sys

GENERATION = 'cli-0.1.22-v12d-367'


def digest(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def manifest_path(root):
    return root / 'generations' / (GENERATION + '.json')


def create_generation(root):
    files = {}
    for directory, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in {'state', 'generations', '__pycache__', '.git'})
        for name in sorted(names):
            path = Path(directory) / name
            if path.suffix != '.pyc':
                files[path.relative_to(root).as_posix()] = digest(path.read_bytes())
    target = manifest_path(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('x', encoding='utf-8') as stream:
        json.dump({'schema': 'prereg-v3-smoke.kitGeneration.v1', 'generation': GENERATION,
                   'issue': 367, 'winClaim': False, 'files': files}, stream, indent=2, sort_keys=True)
        stream.write('\n')
    return target


def verify_generation(root):
    manifest = json.loads(manifest_path(root).read_text())
    for file, expected in manifest['files'].items():
        if digest((root / file).read_bytes()) != expected:
            raise ValueError(f'Immutable kit generation differs: {file}; create a new generation')
    return generation_metadata(root)


def generation_metadata(root):
    path = manifest_path(root)
    if not path.is_file():
        return None
    return {'id': GENERATION, 'manifestHash': digest(path.read_bytes())}


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    if sys.argv[1:] == ['--create']:
        print(create_generation(root))
    elif sys.argv[1:] == ['--verify']:
        print(json.dumps(verify_generation(root)))
    else:
        raise SystemExit('usage: kit_generation.py --create|--verify')
