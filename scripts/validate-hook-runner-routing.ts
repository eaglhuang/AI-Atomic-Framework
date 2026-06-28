import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installGitHooks, inspectGitHooks } from '../packages/cli/src/commands/hook.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const frameworkTemplateHook = readFileSync(path.join(root, 'templates', 'enforcement', 'pre-commit.sh'), 'utf8');
  assert.match(frameworkTemplateHook, /runner="atm\.mjs"/, 'pre-commit enforcement template must declare runner fallback');
  assert.match(frameworkTemplateHook, /runner="atm\.dev\.mjs"/, 'pre-commit enforcement template must switch to atm.dev.mjs when framework source markers exist');
  assert.match(frameworkTemplateHook, /node "\$runner" hook pre-commit --json/, 'pre-commit enforcement template must delegate hook evaluation through the selected runner');
  const frameworkExampleHook = readFileSync(path.join(root, 'examples', 'git-hooks-enforcement', 'hooks', 'pre-commit'), 'utf8');
  assert.match(frameworkExampleHook, /runner="atm\.mjs"/, 'example pre-commit hook must declare runner fallback');
  assert.match(frameworkExampleHook, /runner="atm\.dev\.mjs"/, 'example pre-commit hook must switch to atm.dev.mjs when framework source markers exist');
  assert.match(frameworkExampleHook, /node "\$runner" hook pre-commit --json/, 'example pre-commit hook must delegate through the selected runner');

  const adopterRepo = path.join(tempRoot, 'adopter');
  initRepo(adopterRepo);
  writeFileSync(path.join(adopterRepo, 'package.json'), `${JSON.stringify({ name: 'demo-app' }, null, 2)}\n`, 'utf8');
  const adopterInstall = installGitHooks(adopterRepo);
  assert.equal(adopterInstall.ok, true, 'adopter repo hook install must succeed');
  const adopterHook = readFileSync(path.join(adopterRepo, '.atm', 'git-hooks', 'pre-commit'), 'utf8');
  assert.doesNotMatch(adopterHook, /node "\$runner" hook pre-commit --json/, 'adopter pre-commit hook must not use framework runner arbitration');
  assert.match(adopterHook, /node atm\.mjs hook pre-commit --json/, 'adopter pre-commit hook must keep the frozen runner command');
  copyFileSync(path.join(root, 'templates', 'enforcement', 'pre-commit.sh'), path.join(adopterRepo, '.git', 'hooks', 'pre-commit'));
  const adopterTemplateHook = readFileSync(path.join(adopterRepo, '.git', 'hooks', 'pre-commit'), 'utf8');
  assert.match(adopterTemplateHook, /runner="atm\.mjs"/, 'adopter template hook must still declare runner fallback');
  assert.match(adopterTemplateHook, /node "\$runner" hook pre-commit --json/, 'adopter template hook must route hook evaluation through the selected runner variable');
  assert.doesNotMatch(adopterTemplateHook, /node atm\.dev\.mjs hook pre-commit --json/, 'adopter template hook must not hard-wire the source-first runner');

  console.log('[hook-runner-routing] ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
