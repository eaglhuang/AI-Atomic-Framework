import collections
import datetime as dt
import json
import sys
from pathlib import Path

repo = Path('/workspace/AI-Atomic-Framework-rel')
gen = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else repo / 'research/paper-v2/prereg-v3-pilot/2026-10-23-pilot'
raw = json.loads((gen / 'run/results.json').read_text())

def elapsed(start, end):
    if not start or not end:
        return None
    return (dt.datetime.fromisoformat(end) - dt.datetime.fromisoformat(start)).total_seconds()

def complete_sum(values):
    return sum(values) if values and all(v is not None for v in values) else None

tool_types = {'command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'tool_call'}
sessions = []
arms = []
for name in ('A', 'B'):
    arm = raw['arms'][name]
    tests = arm.get('tests') or []
    decisions = (arm.get('steward') or {}).get('decisions')
    errors = None if decisions is None else decisions.count('kit-error')
    if errors is not None:
        errors += sum(bool(t.get('kitError')) for t in tests)
        errors += int(bool(arm.get('snapshotError')))
    validity = 'INVALID' if arm.get('status') in {'invalid', 'evidence_missing'} or arm.get('missing') or errors else 'VALID'
    if errors is None:
        validity = 'INVALID'
    for session in arm.get('sessions') or []:
        folder = gen / 'run/logs' / f'arm-{name.lower()}' / f"session-{session['slot']}"
        path = folder / 'stdout.jsonl'
        tools = {}
        malformed = 0
        terminal_turns = 0
        if path.is_file():
            for line in path.read_text(errors='replace').splitlines():
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    malformed += 1
                    continue
                item = event.get('item') or {}
                if item.get('type') in tool_types and item.get('id'):
                    tools[item['id']] = item['type']
                if event.get('type') in {'turn.completed', 'turn.failed'}:
                    terminal_turns += 1
        row = {
            'arm': name, 'slot': session['slot'], 'instanceId': session.get('instanceId'),
            'startedAt': session.get('startedAt'), 'endedAt': session.get('endedAt'),
            'wallSeconds': elapsed(session.get('startedAt'), session.get('endedAt')),
            'exitCode': session.get('exitCode'), 'capReached': session.get('exitCode') in (124, 137),
            'tokens': session.get('tokens'),
            'observedToolCalls': len(tools) if path.is_file() else None,
            'observedToolCallsByType': dict(collections.Counter(tools.values())) if path.is_file() else None,
            'toolCallObservationComplete': bool(path.is_file() and not malformed and terminal_turns and session.get('exitCode') == 0),
            'malformedJsonLines': malformed if path.is_file() else None,
            'terminalTurnEvents': terminal_turns if path.is_file() else None,
        }
        sessions.append(row)
    log = gen / 'logs' / f'arm-{name.lower()}'
    start = Path(str(log) + '.started-at')
    end = Path(str(log) + '.ended-at')
    arms.append({
        'arm': name, 'status': arm.get('status'), 'validity': validity,
        'wallSeconds': elapsed(start.read_text().strip(), end.read_text().strip()) if start.is_file() and end.is_file() else None,
        'observedKitErrorCount': errors, 'lostEditCount': arm.get('lostEditCount'),
        'silentLostEditCount': arm.get('silentLostEditCount'), 'conflictCount': arm.get('conflictCount'),
        'stewardRejected': (arm.get('steward') or {}).get('rejected'),
        'stewardReasonCodes': (arm.get('steward') or {}).get('reasonCodes'),
        'tests': [{k: t.get(k) for k in ('instanceId', 'passed', 'failed', 'kitError', 'failToPass', 'passToPass')} for t in tests],
    })
token_keys = ('input_tokens', 'output_tokens', 'total_tokens', 'cached_input_tokens', 'reasoning_output_tokens')
probes = []
for path in sorted((gen / 'run/logs/preflight').glob('run-*/arm-*/attempt-*/stdout.jsonl')):
    usages = []
    tools = {}
    for line in path.read_text(errors='replace').splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event.get('usage'), dict):
            usages.append(event['usage'])
        item = event.get('item') or {}
        if item.get('type') in tool_types and item.get('id'):
            tools[item['id']] = item['type']
    folder = path.parent
    start, end = folder / 'started-at', folder / 'ended-at'
    probes.append({
        'path': str(path.relative_to(gen)),
        'wallSeconds': elapsed(start.read_text().strip(), end.read_text().strip()) if start.is_file() and end.is_file() else None,
        'tokens': {key: complete_sum([u.get(key) for u in usages]) for key in token_keys},
        'observedToolCalls': len(tools),
    })
payload = {
    'label': 'pilot', 'formalEvidence': False, 'winClaim': False,
    'generation': '2026-10-23-pilot', 'kitGeneration': raw.get('kitGeneration'),
    'pairedScorerStatus': raw.get('status'), 'armRuns': len(arms), 'sessions': sessions, 'arms': arms,
    'validArmRuns': sum(a['validity'] == 'VALID' for a in arms),
    'invalidArmRuns': sum(a['validity'] == 'INVALID' for a in arms),
    'kitErrorArmRate': sum(bool(a['observedKitErrorCount']) for a in arms) / len(arms) if all(a['observedKitErrorCount'] is not None for a in arms) else None,
    'observedKitErrorCount': complete_sum([a['observedKitErrorCount'] for a in arms]),
    'measuredTokenAggregates': {key: complete_sum([(s.get('tokens') or {}).get(key) for s in sessions]) for key in token_keys},
    'preflightSessions': probes,
    'preflightTokenAggregates': {key: complete_sum([s['tokens'].get(key) for s in probes]) for key in token_keys},
    'pilotIncludingPreflightTokenAggregates': {key: complete_sum([(s.get('tokens') or {}).get(key) for s in sessions + probes]) for key in token_keys},
    'observedToolCalls': complete_sum([s['observedToolCalls'] for s in sessions]),
    'pairedArmWallSeconds': complete_sum([a['wallSeconds'] for a in arms]),
    'measurementNotes': [
        'Token values are copied from the unchanged pinned scorer. Missing totals remain null; input/output are not relabelled as reported total_tokens.',
        'Tool calls count unique Codex JSONL item IDs of command_execution, file_change, mcp_tool_call, web_search or tool_call; started/completed pairs count once. Shell subcommands are not separate calls.',
        'Tool counts are observed lower bounds if the stream is incomplete; completeness is reported per session.',
        'Wall time is launcher started-at to ended-at, including command startup and CLI latency. Arm wall time includes setup/cleanup within that launcher.',
        'Preflight probes and offline stub checks are excluded from the two task arm runs and four task sessions.',
        'Kit-error arm rate is affected task arm runs divided by attempted task arm runs, not a population estimate.',
    ],
}
(gen / 'pilot-metrics.json').write_text(json.dumps(payload, indent=2) + '\n')
print(json.dumps({k: payload[k] for k in ('pairedScorerStatus', 'validArmRuns', 'invalidArmRuns', 'observedKitErrorCount', 'measuredTokenAggregates', 'pairedArmWallSeconds', 'observedToolCalls')}, indent=2))
