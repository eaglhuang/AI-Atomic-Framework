import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Behavioral regression for the npm adopter path. The published package is
// laid out as node_modules/@ai-atomic-framework/cli with ajv resolved from the
// host install. Run the shipped npm-runtime entrypoint from that layout, not
// from the framework checkout, and require atomize plus proposal create/validate.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageRoot = path.join(root, 'packages', 'cli');
const npmRuntimeEntry = path.join(packageRoot, 'dist', 'npm-runtime', 'atm.mjs');
assert.ok(existsSync(npmRuntimeEntry), 'built npm runtime must exist for the adopter smoke test');

const workspace = mkdtempSync(path.join(tmpdir(), 'atm-npm-smoke-'));
try {
  // Simulated install: the package files plus its runtime deps from the host node_modules.
  const installRoot = path.join(workspace, 'node_modules');
  const cliRoot = path.join(installRoot, '@ai-atomic-framework', 'cli');
  mkdirSync(cliRoot, { recursive: true });
  cpSync(path.join(packageRoot, 'package.json'), path.join(cliRoot, 'package.json'));
  cpSync(path.join(packageRoot, 'dist', 'npm-runtime'), path.join(cliRoot, 'dist', 'npm-runtime'), { recursive: true });
  for (const dep of ['ajv', 'ajv-formats', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string']) {
    symlinkSync(path.join(root, 'node_modules', dep), path.join(installRoot, dep), 'dir');
  }
  const entry = path.join(cliRoot, 'dist', 'npm-runtime', 'atm.mjs');

  const adopter = path.join(workspace, 'adopter');
  mkdirSync(path.join(adopter, 'packages', 'app', 'src'), { recursive: true });
  writeFileSync(path.join(adopter, 'package.json'), '{"name":"adopter-smoke","version":"0.0.1"}\n');
  writeFileSync(path.join(adopter, 'packages', 'app', 'src', 'greet.ts'), 'export function greet(name: string) {\n  return `hi ${name}`;\n}\n');
  const git = (args: string[]) => {
    const result = spawnSync('git', ['-C', adopter, '-c', 'user.email=smoke@example.invalid', '-c', 'user.name=smoke', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  };
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'app']);

  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, [entry, ...args, '--cwd', adopter, '--json'], { cwd: adopter, encoding: 'utf8', timeout: 120_000 });
    const stdout = result.stdout.trim();
    if (!stdout.startsWith('{')) {
      // One short line that survives the CI report's stderr tail: exit code and both output heads.
      process.stderr.write(`DIAG ${args.join(' ')} exit=${result.status} stdout=${JSON.stringify(stdout.slice(0, 240))} stderr=${JSON.stringify(result.stderr.slice(0, 480))}\n`);
      process.exit(1);
    }
    return JSON.parse(stdout) as { ok: boolean; messages: { code: string; text: string }[] };
  };

  const inventory = run(['atomize', 'inventory']);
  assert.equal(inventory.ok, true, `atomize inventory must succeed from the npm install: ${JSON.stringify(inventory.messages)}`);
  const backfill = run(['atomize', 'backfill']);
  assert.equal(backfill.ok, true, `atomize backfill must succeed from the npm install: ${JSON.stringify(backfill.messages)}`);

  const head = spawnSync('git', ['-C', adopter, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const targetFile = path.join(adopter, 'packages', 'app', 'src', 'greet.ts');
  writeFileSync(path.join(adopter, 'proposal.json'), `${JSON.stringify({
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'smoke' },
    proposalId: 'NPM-SMOKE-P-1',
    taskId: 'NPM-SMOKE-TASK-1',
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
  const create = run(['broker', 'proposal', 'create', '--proposal-file', 'proposal.json']);
  assert.equal(create.ok, true, `broker proposal create must validate from the npm install: ${JSON.stringify(create.messages)}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log('[npm-runtime-adopter-atomize-proposal:test] ok');
