#!/usr/bin/env python3
"""#360 AC9: cross-session-overlap rejections, acknowledged overrides and merged-both
resubmissions are counted apart from the other rejection codes."""
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'bin'))
import evaluate

rows = [
    {'actorId': 's1', 'file': 'a.py', 'decision': 'accepted', 'reasonCode': None},
    {'actorId': 's2', 'file': 'a.py', 'decision': 'rejected-by-design', 'reasonCode': 'cross-session-overlap'},
    {'actorId': 's2', 'file': 'a.py', 'decision': 'accepted', 'reasonCode': None},
    {'actorId': 's3', 'file': 'a.py', 'decision': 'rejected-by-design', 'reasonCode': 'cross-session-overlap'},
    {'actorId': 's3', 'file': 'a.py', 'decision': 'accepted', 'reasonCode': None, 'acknowledgedOverlap': ['p1']},
    {'actorId': 's4', 'file': 'a.py', 'decision': 'rejected-by-design', 'reasonCode': 'patch-context-mismatch'},
    {'actorId': 's4', 'file': 'a.py', 'decision': 'rejected-by-design', 'reasonCode': 'overlapping-write-queued'},
    {'actorId': 's4', 'file': 'a.py', 'decision': 'accepted', 'reasonCode': None},
]
assert evaluate.cross_session_counts(rows) == {
    'crossSessionOverlapRejections': 2, 'acknowledgedOverrides': 1, 'mergedBothResubmissions': 1,
}, evaluate.cross_session_counts(rows)
assert evaluate.cross_session_counts([]) == {
    'crossSessionOverlapRejections': 0, 'acknowledgedOverrides': 0, 'mergedBothResubmissions': 0,
}
# overlapping-write-queued stays a conflict; cross-session-overlap is not folded into it.
assert evaluate.conflict_count(pathlib.Path('/nonexistent'), [{'reasonCode': 'cross-session-overlap'}]) is None
print('cross-session metrics ok')
