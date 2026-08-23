import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorizeRunnerPublicationTakeover } from '../../packages/cli/src/commands/framework-development/runner-publication-lifecycle.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-physical-takeover-'));
const write = (relative: string, value: string) => {
  const target = path.join(repo, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value, 'utf8');
};

try {
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: repo });
  write('release/atm-onefile/atm.mjs', 'baseline runner\n');
  write('release/atm-onefile/release-manifest.json', '{}\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: repo, stdio: 'ignore' });
  write('release/atm-onefile/atm.mjs', 'owned dirty runner\n');
  write('release/atm-onefile/release-manifest.json', '{"dirty":true}\n');
  mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });

  const plan = authorizeRunnerPublicationTakeover({
    cwd: repo,
    taskId: 'ATM-FRAMEWORK-TEMP-fixture',
    sealedSourceSha: 'a'.repeat(40),
    buildTarget: 'full',
    currentTaskAllowedFiles: ['release/atm-onefile/atm.mjs']
  });
  assert.deepEqual(plan.entries.map((entry) => entry.path), [
    'release/atm-onefile/atm.mjs',
    'release/atm-onefile/release-manifest.json'
  ]);
  console.log('[runner-publication-physical-takeover.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
