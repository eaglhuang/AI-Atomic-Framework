import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanNpmConsumerEnvironment, runCleanNpmConsumerCommand, runFirstUseChain } from '../../scripts/lib/npm-first-use.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-clean-env-'));
const packageRoot = path.join(root, 'node_modules', '@ai-atomic-framework', 'cli');
const script = path.join(packageRoot, 'fixture.cjs');
const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'atm.cmd' : 'atm');
const original = process.env.ATM_ACTOR_ID;
try {
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@ai-atomic-framework/cli', bin: { atm: 'fixture.cjs' } }));
  const parent = { PATH: 'keep-path', HOME: 'keep-home', ATM_ACTOR_ID: 'foreign',
    ATM_PINNED_RUNNER_SOURCE: 'foreign-runner', atm_future_flag: 'foreign', AGENT_IDENTITY: 'legacy' };
  assert.deepEqual(cleanNpmConsumerEnvironment(parent), { PATH: 'keep-path', HOME: 'keep-home' });
  assert.equal(parent.ATM_ACTOR_ID, 'foreign');
  writeFileSync(script, `
    if (process.env.ATM_ACTOR_ID) {
      console.error('inherited actor leaked into clean consumer'); process.exit(2);
    }
    if (process.argv[2] === 'echo-args') {
      console.log(JSON.stringify(process.argv.slice(3))); process.exit(0);
    }
    console.log(JSON.stringify({ evidence: { nextAction: { status: 'ready' } } }));
  `);
  if (process.platform === 'win32') {
    writeFileSync(bin, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(bin, 0o755);
  }
  process.env.ATM_ACTOR_ID = 'foreign-parent-actor';
  const result = runFirstUseChain(bin, root);
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(process.env.ATM_ACTOR_ID, 'foreign-parent-actor', 'parent environment remains unchanged');
  const args = ['multiple words', 'quote"and&shell|characters', 'C:/path with spaces'];
  const echoed = runCleanNpmConsumerCommand(bin, ['echo-args', ...args], root);
  assert.equal(echoed.status, 0);
  assert.deepEqual(JSON.parse(echoed.stdout), args, 'argv must not pass through shell tokenization');
  assert.equal(runCleanNpmConsumerCommand(bin, ['--version', '--json'], root).status, 0,
    'npm bin wrapper remains exercised rather than bypassed by every smoke');
  for (const name of ['validate-candidate-npm-install.ts', 'validate-public-npm-install.ts']) {
    const source = readFileSync(new URL(`../../scripts/${name}`, import.meta.url), 'utf8');
    assert.match(source, /runCleanNpmConsumerCommand\(bin,/, `${name} smoke must use the shared clean execution boundary`);
  }
  console.log('[npm-first-use-environment.test] ok');
} finally {
  if (original === undefined) delete process.env.ATM_ACTOR_ID;
  else process.env.ATM_ACTOR_ID = original;
  rmSync(root, { recursive: true, force: true });
}
