import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Behavioral regression: the embedded onefile runner, executed from an empty
// adopter repository (no node_modules, no framework checkout), must be able to
// run atomize inventory/backfill and create+validate a broker proposal.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const onefile = path.join(root, 'release', 'atm-onefile', 'atm.mjs');
assert.ok(existsSync(onefile), 'committed onefile runner must exist for the adopter smoke test');

const adopter = mkdtempSync(path.join(tmpdir(), 'atm-adopter-smoke-'));
try {
  const git = (args: string[]) => {
    const result = spawnSync('git', ['-C', adopter, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  };
  git(['init', '-q']);
  git(['-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '--allow-empty', '-q', '-m', 'init']);
  writeFileSync(path.join(adopter, 'package.json'), '{"name":"adopter-smoke","version":"0.0.1"}\n');
  mkdirSync(path.join(adopter, 'packages', 'app', 'src'), { recursive: true });
  writeFileSync(path.join(adopter, 'packages', 'app', 'src', 'greet.ts'), 'export function greet(name: string) {\n  return `hi ${name}`;\n}\n');
  git(['add', '-A']);
  git(['-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', 'commit', '-q', '-m', 'app']);

  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, [onefile, ...args, '--cwd', adopter, '--json'], { encoding: 'utf8', timeout: 120_000 });
    const stdout = result.stdout.trim();
    assert.ok(stdout.startsWith('{'), `onefile ${args.join(' ')} must emit JSON, got stderr: ${result.stderr}`);
    return JSON.parse(stdout) as { ok: boolean; messages: { code: string; text: string }[] };
  };

  const inventory = run(['atomize', 'inventory']);
  assert.equal(inventory.ok, true, `atomize inventory must succeed in an adopter repo: ${JSON.stringify(inventory.messages)}`);

  const backfill = run(['atomize', 'backfill']);
  assert.equal(backfill.ok, true, `atomize backfill must succeed in an adopter repo: ${JSON.stringify(backfill.messages)}`);

  const targetFile = path.join(adopter, 'packages', 'app', 'src', 'greet.ts');
  const head = spawnSync('git', ['-C', adopter, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const proposalPath = path.join(adopter, 'proposal.json');
  writeFileSync(proposalPath, `${JSON.stringify({
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'smoke' },
    proposalId: 'SMOKE-P-1',
    taskId: 'SMOKE-TASK-1',
    actorId: 'smoke-actor',
    baseCommit: head,
    fileBeforeHash: `sha256:${createHash('sha256').update(readFileSync(targetFile)).digest('hex')}`,
    targetFile: 'packages/app/src/greet.ts',
    atomRefs: [{ atomId: 'ATM-SMOKE-0001', atomCid: 'atom:cid:smoke-placeholder' }],
    anchors: [{ kind: 'symbol', hint: 'greet' }],
    intent: 'smoke',
    patch: '--- a\n+++ b\n',
    validators: ['npm test'],
    rollback: 'git revert'
  }, null, 2)}\n`);

  // Schema validation is the path that needs ajv; it must resolve without a host node_modules.
  const create = run(['broker', 'proposal', 'create', '--proposal-file', 'proposal.json']);
  assert.equal(create.ok, true, `broker proposal create must validate in an adopter repo: ${JSON.stringify(create.messages)}`);
} finally {
  rmSync(adopter, { recursive: true, force: true });
}

console.log('[onefile-adopter-atomize-proposal:test] ok');
