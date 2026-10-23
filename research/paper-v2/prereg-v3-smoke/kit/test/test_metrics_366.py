#!/usr/bin/env python3
"""Synthetic copies reproduce v10c rec 3 -> rec 5; sealed runs stay untouched."""
import json
import pathlib
import subprocess
import sys
import tempfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'bin'))
import evaluate
from metrics_provenance import journal_evidence, journal_resubmissions, measured_wait
from kit_generation import create_generation, verify_generation


def git(work, *args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(work), *args], text=True, stderr=subprocess.DEVNULL).strip()


def test_arm(prior_rejection):
    with tempfile.TemporaryDirectory() as tmp:
        arm = pathlib.Path(tmp)
        work = arm / 'work'
        work.mkdir()
        git(work, 'init', '-q')
        git(work, 'config', 'user.name', 'fixture')
        git(work, 'config', 'user.email', 'fixture@localhost')
        target = work / 'shared.py'
        target.write_text('alpha\nbeta\n')
        git(work, 'add', 'shared.py')
        git(work, 'commit', '-qm', 'base')
        base = git(work, 'rev-parse', 'HEAD')
        def row(slot, proposal, text, decision='accepted', attempt=1):
            return {'actorId': f's{slot}', 'sessionSlot': str(slot), 'taskId': f't{slot}',
                    'proposalId': proposal, 'file': 'shared.py', 'currentFileText': text,
                    'decision': decision, 'terminal': 'committed' if decision == 'accepted' else 'blocked',
                    'reasonCode': None if decision == 'accepted' else 'patch-context-mismatch',
                    'declaredBaseHash': 'same', 'currentFileHash': 'same',
                    'attempt': attempt, 'retryCount': attempt - 1, 'intentSpans': [[2, 2]],
                    'commit': {'gitIndexLockWaitMs': None}, 'hashDriftCount': None}
        rows = [row(1, 'rec3', 'alpha\naccepted-A\n', attempt=2 if prior_rejection else 1),
                row(2, 'rec5', 'alpha\naccepted-B\n')]
        if prior_rejection:
            rows.insert(0, row(1, 'rejected', 'alpha\nbeta\n', 'rejected-by-design'))
        for entry in rows:
            if entry['decision'] == 'accepted':
                target.write_text(entry['currentFileText'])
                git(work, 'add', 'shared.py')
                git(work, 'commit', '-qm', entry['proposalId'])
        smoke = work / '.prereg-smoke'
        smoke.mkdir()
        journal = smoke / 'steward-writes.jsonl'
        journal.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        for slot in (1, 2):
            session = arm / f'session-{slot}'
            session.mkdir()
            value = 'accepted-A' if slot == 1 else 'accepted-B'
            (session / 'intended.patch').write_text(f'diff --git a/shared.py b/shared.py\n--- a/shared.py\n+++ b/shared.py\n@@ -2 +2 @@\n-beta\n+{value}\n')
            events = [{'type': 'item.completed', 'item': {'type': 'command_execution', 'id': row['proposalId'],
                       'command': 'atm-write shared.py <(printf patch)', 'exit_code': 0 if row['decision'] == 'accepted' else 3,
                       'aggregated_output': json.dumps(row)}} for row in rows if row['sessionSlot'] == str(slot)]
            (session / 'stdout.jsonl').write_text(''.join(json.dumps(event) + '\n' for event in events))
        tasks = {'primary': {'instances': [{'instanceId': 'one', 'problemStatement': 'one'},
                                           {'instanceId': 'two', 'problemStatement': 'two'}]}}
        score = evaluate.score_arm('B', arm, tasks, base)
        assert score['lostEditCount'] == 1, score
        assert score['silentLostEditCount'] == (0 if prior_rejection else 1), score
        assert score['conflictCount'] == 1, score
        loss = score['sessions'][0]['lostEdits'][0]
        assert loss['acceptedProposals'] == ['rec3'] and loss['removedByProposals'] == ['rec5'], loss
        assert loss.get('classified') != 'steward-rejected', loss
        steward = score['steward']
        assert steward['retryCount'] == steward['resubmissions'] == int(prior_rejection), steward
        assert steward['queueWaitMs'] == [None] * len(rows), steward
        # Infrastructure failures still invalidate an otherwise measurable arm.
        rows.append({**rows[-1], 'decision': 'kit-error', 'reasonCode': 'cli-crash'})
        journal.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        assert evaluate.score_arm('B', arm, tasks, base)['status'] == 'invalid'


for prior in (False, True):
    test_arm(prior)
assert measured_wait({}) is None
assert measured_wait({'commit': {'gitIndexLockWaitMs': 0}}) == 0
assert journal_resubmissions([{'attempt': 1}]) is None
assert evaluate.conflict_count(pathlib.Path('/nonexistent'), [{'reasonCode': 'cross-session-overlap'}]) == 1
assert evaluate.conflict_count(pathlib.Path('/nonexistent'), [{'decision': 'accepted', 'acknowledgedOverlap': ['p']}]) == 1
print('issue 366 accepted loss attribution, silent loss, conflicts, retry and null fixtures passed')

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    (root / 'source.py').write_text('original')
    create_generation(root)
    assert verify_generation(root)['id'] == 'cli-0.1.22-v13-367'
    try:
        create_generation(root)
        raise AssertionError('generation overwritten')
    except FileExistsError:
        pass
    (root / 'source.py').write_text('changed')
    try:
        verify_generation(root)
        raise AssertionError('changed generation verified')
    except ValueError:
        pass
print('immutable kit generation passed')
