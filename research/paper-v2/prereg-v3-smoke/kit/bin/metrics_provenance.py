"""Journal-derived accepted-line provenance; no declared/live hash inference."""
from difflib import SequenceMatcher


def owner(row):
    return (row.get('actorId'), row.get('sessionSlot'))


def journal_evidence(rows, base_text, final_text):
    """Walk accepted snapshots, retaining each added line's originating receipt.

    A later accepted row removing another actor's line is observed contention.
    Only lines absent from the final snapshot are reported as losses. Rejected
    rows never own lines, and never erase an accepted row's provenance.
    """
    states, losses, conflicts = {}, [], set()
    for index, row in enumerate(rows):
        if row.get('reasonCode') in {'cross-session-overlap', 'overlapping-write-queued',
                                     'overlapping-write-conflict'} or row.get('acknowledgedOverlap'):
            conflicts.add(index)
        file, after = row.get('file'), row.get('currentFileText')
        if row.get('decision') != 'accepted' or not file or not isinstance(after, str):
            continue
        if file not in states:
            text = base_text(file)
            if text is None:
                continue
            states[file] = [(line, None) for line in text.splitlines()]
        before = states[file]
        following = []
        lines = after.splitlines()
        for tag, a, b, c, d in SequenceMatcher(None, [x[0] for x in before], lines, autojunk=False).get_opcodes():
            if tag == 'equal':
                following.extend(before[a:b])
                continue
            for line, origin in before[a:b]:
                if origin is not None and owner(rows[origin]) != owner(row):
                    conflicts.add(index)
                    losses.append({'file': file, 'line': line, 'origin': origin, 'removedBy': index})
            following.extend((line, index) for line in lines[c:d])
        states[file] = following
    losses = [item for item in losses if item['line'] not in (final_text(item['file']) or '').splitlines()]
    return losses, conflicts


def rows_for_session(rows, slot, stdout, receipts):
    linked = receipts(rows, stdout)
    if linked is not None:
        ids = {id(row) for row in linked}
        return {index for index, row in enumerate(rows) if id(row) in ids}
    return {index for index, row in enumerate(rows) if str(row.get('sessionSlot')) == str(slot)}


def loss_items(losses, indices, rows):
    grouped = {}
    for loss in losses:
        if loss['origin'] not in indices:
            continue
        file = loss['file']
        item = grouped.setdefault(file, {'file': file, 'missingAddedLines': [], 'missingCount': 0,
                                         'match': 'journal', 'acceptedProposals': [], 'removedByProposals': []})
        item['missingCount'] += 1
        item['missingAddedLines'].append(loss['line'])
        for key, index in [('acceptedProposals', loss['origin']), ('removedByProposals', loss['removedBy'])]:
            proposal = rows[index].get('proposalId')
            if proposal not in item[key]:
                item[key].append(proposal)
    return list(grouped.values())


def measured_wait(row):
    value = (row.get('commit') or {}).get('gitIndexLockWaitMs')
    return value if type(value) is int and value >= 0 else None


def journal_resubmissions(rows):
    """A retried row counts once, not its cumulative retryCount each time."""
    if not rows or any(type(row.get('attempt')) is not int or 'intentSpans' not in row for row in rows):
        return None
    return sum(row['attempt'] > 1 for row in rows)
