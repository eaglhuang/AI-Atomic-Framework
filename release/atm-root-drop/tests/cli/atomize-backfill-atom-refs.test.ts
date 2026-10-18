import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression: a fresh adopter repo must be able to go from `atomize backfill`
// straight to a broker proposal. Backfill used to emit atomId-only placeholders,
// so the proposal had no atomRefs with atomCid and preflight failed with
// missing-atom-refs. The backfill output must carry usable atomRefs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const devRunner = path.join(root, 'atm.dev.mjs');
assert.ok(existsSync(devRunner), 'source runner atm.dev.mjs must exist');

const adopter = mkdtempSync(path.join(tmpdir(), 'atm-backfill-atomref-'));
try {
  const git = (args: string[]) => {
    const result = spawnSync('git', ['-C', adopter, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  };
  git(['init', '-q']);
  writeFileSync(path.join(adopter, 'package.json'), '{"name":"adopter-atomref","version":"0.0.1"}\n');
  mkdirSync(path.join(adopter, 'packages', 'app', 'src'), { recursive: true });
  writeFileSync(path.join(adopter, 'packages', 'app', 'src', 'greet.ts'), 'export function greet(name: string) {\n  return `hi ${name}`;\n}\n');
  git(['add', '-A']);
  git(['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '-q', '-m', 'app']);

  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, [devRunner, ...args, '--cwd', adopter, '--json'], { cwd: adopter, encoding: 'utf8', timeout: 120_000 });
    const stdout = result.stdout.trim();
    assert.ok(stdout.startsWith('{'), `atm ${args.join(' ')} must emit JSON, got stderr: ${result.stderr}`);
    return JSON.parse(stdout) as { ok: boolean; messages: { code: string; text: string }[] };
  };

  const backfill = run(['atomize', 'backfill', '--apply']);
  assert.equal(backfill.ok, true, `atomize backfill must succeed: ${JSON.stringify(backfill.messages)}`);

  const backfillProposal = JSON.parse(readFileSync(path.join(adopter, 'atomic_workbench', 'atomization-coverage', 'atom-backfill-proposal.json'), 'utf8'));
  const entry = backfillProposal.proposals.find((item: { path: string }) => item.path === 'packages/app/src/greet.ts');
  assert.ok(entry, 'backfill must propose the greet.ts atom');
  assert.equal(entry.atomRefs.length, 1, 'backfill entry must carry exactly one atomRef');
  assert.equal(entry.atomRefs[0].atomId, entry.atomId);
  assert.match(entry.atomRefs[0].atomCid, /^atom:cid:/, 'atomRef must carry a real atomCid, not a placeholder');

  const head = spawnSync('git', ['-C', adopter, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const targetFile = path.join(adopter, 'packages', 'app', 'src', 'greet.ts');
  const proposalPath = path.join(adopter, 'proposal.json');
  writeFileSync(proposalPath, `${JSON.stringify({
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'regression' },
    proposalId: 'ATOMREF-P-1',
    taskId: 'ATOMREF-TASK-1',
    actorId: 'regression-actor',
    baseCommit: head,
    fileBeforeHash: `sha256:${createHash('sha256').update(readFileSync(targetFile)).digest('hex')}`,
    targetFile: 'packages/app/src/greet.ts',
    atomRefs: entry.atomRefs,
    anchors: [{ kind: 'symbol', hint: 'greet' }],
    intent: 'regression',
    patch: '--- a\n+++ b\n',
    validators: ['npm test'],
    rollback: 'git revert'
  }, null, 2)}\n`);

  const create = run(['broker', 'proposal', 'create', '--proposal-file', 'proposal.json']);
  assert.equal(create.ok, true, `proposal built from backfill atomRefs must pass preflight: ${JSON.stringify(create.messages)}`);
} finally {
  rmSync(adopter, { recursive: true, force: true });
}

console.log('[atomize-backfill-atom-refs:test] ok');
