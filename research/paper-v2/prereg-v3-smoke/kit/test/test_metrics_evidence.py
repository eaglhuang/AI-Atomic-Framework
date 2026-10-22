#!/usr/bin/env python3
"""Offline evidence semantics: absent measurements are not measured zeroes."""
import json
import pathlib
import sys
import tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'bin'))
import evaluate

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    assert evaluate.tokens_of(root)['total_tokens'] is None
    path = root / 'stdout.jsonl'
    path.write_text(json.dumps({'usage': {'input_tokens': 12, 'output_tokens': 3,
                                        'cached_input_tokens': 8, 'reasoning_output_tokens': 2}})+'\n')
    result = evaluate.tokens_of(root)
    assert result == {'input_tokens': 12, 'output_tokens': 3, 'total_tokens': None,
                      'cached_input_tokens': 8, 'reasoning_output_tokens': 2, 'events': 1}, result
    path.write_text(json.dumps({'message': {'usage': {'input_tokens': 0, 'output_tokens': 0,
                    'total_tokens': 0, 'cached_input_tokens': 0, 'reasoning_output_tokens': 0}}})+'\n')
    assert evaluate.tokens_of(root)['total_tokens'] == 0
    path.write_text(json.dumps({'usage': {'input_tokens': 1, 'total_tokens': 3}})+'\n'+
                    json.dumps({'usage': {'input_tokens': 2}})+'\n')
    result = evaluate.tokens_of(root)
    assert result['input_tokens'] == 3 and result['total_tokens'] is None, result
    path.write_text('{broken\n'+json.dumps({'usage': {'total_tokens': False}})+'\n')
    assert evaluate.tokens_of(root)['total_tokens'] is None
    assert evaluate.conflict_count(root, []) is None
    rejected = {'decision': 'rejected-by-design', 'terminal': 'blocked',
                'reasonCode': 'patch-context-mismatch', 'declaredBaseHash': 'sha256:a',
                'currentFileHash': 'sha256:a'}
    assert evaluate.conflict_count(root, [rejected]) is None
    assert evaluate.classify_write(rejected) == 'rejected-by-design'
    unknown = {**rejected, 'currentFileHash': 'sha256:b'}
    assert evaluate.conflict_count(root, [unknown]) is None
    assert evaluate.conflict_count(root, [unknown, {'decision':'accepted', 'terminal':'committed'}]) is None
    assert evaluate.conflict_count(root, [unknown, {'reasonCode':'overlapping-write-queued'}]) == 1
    assert evaluate.conflict_count(root, [{'reasonCode': 'quota'}]) is None
    conflict = {'reasonCode': 'overlapping-write-queued'}
    assert evaluate.conflict_count(root, [rejected, conflict]) == 1
    # Only completed failed git commands count as index-lock contention.
    session = root / 'session-1'; session.mkdir()
    (session / 'stdout.jsonl').write_text(json.dumps({'type':'item.completed', 'item': {
        'type':'command_execution', 'id':'lock1', 'command':'git commit -m test',
        'exit_code':1, 'aggregated_output':'fatal: index.lock exists'}})+'\n')
    assert evaluate.conflict_count(root, [rejected]) == 1
print('metrics evidence null/zero, partial usage, rejection and conflict tests passed')
