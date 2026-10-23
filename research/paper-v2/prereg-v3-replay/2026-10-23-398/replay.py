"""Model-free original #398 replay. Outputs are exclusive new destinations."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPO = Path('/workspace/AI-Atomic-Framework-rel')
GEN = Path(__file__).resolve().parent
SCRATCH = REPO / 'n0'
KIT = REPO / 'research/paper-v2/prereg-v3-smoke/kit'
CLI = REPO / '.worklogs/public-cli/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs'
NODE = Path('/home/box/.local/node24-latest/bin/node')
BASE = '98ad327864aed8df245fd19ea9d2743279e11643'
FILE = 'django/db/migrations/loader.py'
GUARD = "if getattr(module, '__file__', None) is None and not isinstance(module.__path__, list):"
ENV = {**os.environ, 'TMPDIR': str(SCRATCH / 't'), 'GIT_AUTHOR_NAME': 'prereg-replay',
       'GIT_AUTHOR_EMAIL': 'prereg-replay@localhost', 'GIT_COMMITTER_NAME': 'prereg-replay',
       'GIT_COMMITTER_EMAIL': 'prereg-replay@localhost'}

def run(args, cwd=None, check=True, env=None):
    return subprocess.run([str(x) for x in args], cwd=cwd, env=env or ENV,
                          capture_output=True, text=True, timeout=90, check=check)

def digest(text):
    return 'sha256:' + hashlib.sha256(text.encode()).hexdigest()

def record(path, value):
    with path.open('x') as f:
        json.dump(value, f, indent=2)
        f.write('\n')

def fixture(mode):
    work = SCRATCH / ('398-' + mode)
    assert not work.exists()
    run(['git', 'clone', '--shared', '--no-checkout', '--quiet', REPO / 'r13/template', work])
    run(['git', 'sparse-checkout', 'set', '--no-cone', FILE], work)
    run(['git', 'checkout', '--force', '--detach', '--quiet', BASE], work)
    assert digest((work / FILE).read_text()) == 'sha256:7dca66d253358f3dfbda3d68ceffb8b9fee4d0f47d8ddef2fa4d25e78ff1b05c'
    (work / '.prereg-smoke').mkdir()
    return work

original = json.loads((GEN / 'inputs/original-receipts.json').read_text())
template = json.loads((GEN / 'inputs/prop-prereg-session-slot-1-a1-0089d042f0fc.proposal.json').read_text())
record(GEN / 'cli-identity.json', json.loads(run([NODE, CLI, '--version']).stdout))
record(GEN / 'kit-identity.json', json.loads(run(['python3', KIT / 'bin/kit_generation.py', '--verify']).stdout))
results = {}
for mode in ('old-kit', 'direct-cli'):
    work = fixture(mode)
    output = GEN / 'logs' / mode
    output.mkdir()
    if mode == 'old-kit':
        config = {'cli': str(CLI), 'cliVersion': '0.1.22', 'boundary': 'unix-user',
                  'safePath': '/home/box/.local/node24-latest/bin:/usr/bin:/bin', 'writableRoot': str(work)}
        record(work / '.prereg-smoke/session-write.json', config)
    seen = {}
    observations = []
    for i, row in enumerate(original, 1):
        slot = row['sessionSlot']
        patch = (GEN / row['inputPatch']).read_text()
        assert digest(patch) == row['patchHash']
        before = (work / FILE).read_text()
        if mode == 'old-kit':
            command = [NODE, KIT / 'bin/atm-write.mjs', FILE, GEN / row['inputPatch'], '--cwd', work,
                       '--task', 'prereg']
            env = {**ENV, 'PREREG_SESSION_SLOT': slot, 'PREREG_SESSION_BASE_COMMIT': BASE}
            proc = run(command, work, check=False, env=env)
            payload = json.loads(proc.stdout)
            observation = payload
        else:
            proposal = {**template, 'proposalId': f'direct-398-{i}-slot-{slot}',
                        'actorId': f'prereg-session-slot-{slot}', 'taskId': 'prereg',
                        'baseCommit': run(['git', 'rev-parse', 'HEAD'], work).stdout.strip(),
                        'fileBeforeHash': seen.get(slot, digest(run(['git', 'show', BASE + ':' + FILE], work).stdout)),
                        'targetFile': FILE, 'patch': patch, 'anchors': [{'kind': 'file', 'hint': 'whole-file'}]}
            proposal_path = work / '.prereg-smoke' / f'{i}.proposal.json'
            record(proposal_path, proposal)
            command = [NODE, CLI, 'broker', 'steward', 'apply-live', '--cwd', work,
                       '--proposal-file', proposal_path, '--scope-file', FILE,
                       '--steward-id', 'neutral-write-steward', '--json']
            proc = run(command, work, check=False)
            payload = json.loads(proc.stdout)
            records = payload.get('evidence', {}).get('liveWrites', [])
            assert len(records) == 1, payload
            observation = records[0]
            if observation.get('currentFileHash'):
                seen[slot] = observation['currentFileHash']
        (output / f'{i}.stdout.json').write_text(proc.stdout)
        (output / f'{i}.stderr.txt').write_text(proc.stderr)
        (output / f'{i}.command.json').write_text(json.dumps([str(x) for x in command], indent=2) + '\n')
        after = (work / FILE).read_text()
        (output / f'{i}.before.py').write_text(before)
        (output / f'{i}.after.py').write_text(after)
        observations.append({'step': i, 'slot': slot, 'exitCode': proc.returncode,
                             'decision': observation.get('decision'), 'reasonCode': observation.get('reasonCode'),
                             'currentFileHash': observation.get('currentFileHash'),
                             'guardPresentBefore': GUARD in before, 'guardPresentAfter': GUARD in after,
                             'head': run(['git', 'rev-parse', 'HEAD'], work).stdout.strip()})
    (output / 'git-log.txt').write_text(run(['git', 'log', '--format=%H %s', BASE + '..HEAD'], work).stdout)
    for name in ['live-write-anchors.jsonl', 'live-write-journal.jsonl']:
        path = work / '.atm/runtime' / name
        if path.exists():
            (output / name).write_bytes(path.read_bytes())
    results[mode] = observations
old = results['old-kit'][-1]
direct = results['direct-cli'][-1]
assert old['decision'] == 'accepted' and not old['guardPresentAfter'], results
assert direct['decision'] != 'accepted' and direct['guardPresentAfter'], results
record(GEN / 'results.json', {'label': 'model-free diagnostic replay', 'issue': 398,
       'commonBase': BASE, 'modelCalls': 0, 'kitPin': 'cli-0.1.22-v13-367', 'cliPin': '0.1.22',
       'originalInputArchive': 'r12f', 'originalPatchHashesVerified': True, 'modes': results,
       'attribution': 'kit early malformed rejection bypasses core original-intent anchor; direct published CLI preserves it',
       'winClaim': False, 'formalEvidence': False})
print(json.dumps({'oldKitFinal': old, 'directCliFinal': direct, 'modelCalls': 0}, indent=2))
