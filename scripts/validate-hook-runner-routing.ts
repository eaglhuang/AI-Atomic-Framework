import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installGitHooks, inspectGitHooks } from '../packages/cli/src/commands/hook.ts';

function initRepo(root: string) {
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
}

function writeFrameworkMarkers(root: string) {
  mkdirSync(path.join(root, 'packages', 'cli', 'src'), { recursive: true });
  mkdirSync(path.join(root, 'packages', 'core', 'src'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'ai-atomic-framework' }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(root, 'atm.dev.mjs'), 'console.log("dev");\n', 'utf8');
  writeFileSync(path.join(root, 'packages', 'cli', 'src', 'atm.ts'), 'export {};\n', 'utf8');
  writeFileSync(path.join(root, 'packages', 'core', 'src', 'index.ts'), 'export {};\n', 'utf8');
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-runner-routing-'));

try {
  const frameworkRepo = path.join(tempRoot, 'framework');
  initRepo(frameworkRepo);
  writeFrameworkMarkers(frameworkRepo);
  const frameworkInstall = installGitHooks(frameworkRepo);
  assert.equal(frameworkInstall.ok, true, 'framework repo hook install must succeed');
  const frameworkHook = readFileSync(path.join(frameworkRepo, '.atm', 'git-hooks', 'pre-commit'), 'utf8');
  assert.match(frameworkHook, /runner="atm\.mjs"/, 'framework pre-commit hook must declare runner fallback');
  assert.match(frameworkHook, /runner="atm\.dev\.mjs"/, 'framework pre-commit hook must switch to atm.dev.mjs when source markers exist');
  assert.match(frameworkHook, /node "\$runner" hook pre-commit --json/, 'framework pre-commit hook must delegate through the selected runner');
  const frameworkVerify = inspectGitHooks(frameworkRepo);
  assert.equal(frameworkVerify.ok, true, 'framework repo hook verify must accept runtime runner selection');

  const adopterRepo = path.join(tempRoot, 'adopter');
  initRepo(adopterRepo);
  writeFileSync(path.join(adopterRepo, 'package.json'), `${JSON.stringify({ name: 'demo-app' }, null, 2)}\n`, 'utf8');
  const adopterInstall = installGitHooks(adopterRepo);
  assert.equal(adopterInstall.ok, true, 'adopter repo hook install must succeed');
  const adopterHook = readFileSync(path.join(adopterRepo, '.atm', 'git-hooks', 'pre-commit'), 'utf8');
  assert.doesNotMatch(adopterHook, /node "\$runner" hook pre-commit --json/, 'adopter pre-commit hook must not use framework runner arbitration');
  assert.match(adopterHook, /node atm\.mjs hook pre-commit --json/, 'adopter pre-commit hook must keep the frozen runner command');

  console.log('[hook-runner-routing] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
