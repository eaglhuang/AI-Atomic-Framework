import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: any) {
  console.error(`[git-hooks-enforcement:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function run(command: any, args: any, cwd: any, options: any = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    ...options
  });
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    fail(`${command} ${args.join(' ')} failed\nerror:\n${result.error?.message || ''}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  return result;
}

function runGit(repo: any, args: any, options: any = {}) {
  return run('git', args, repo, options);
}

function runDoctor(repo: any) {
  const result = run(process.execPath, ['atm.mjs', 'doctor', '--json'], repo, { allowFailure: true });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: payload ? JSON.parse(payload) : {}
  };
}

function copyRuntime(sourceRoot: any, targetRoot: any) {
  for (const entry of ['atm.mjs', 'atomic-registry.json', 'packages', 'scripts', 'specs', 'templates', 'examples']) {
    cpSync(path.join(sourceRoot, entry), path.join(targetRoot, entry), { recursive: true });
  }
}

function installHooks(repo: any) {
  const hooksDir = path.join(repo, '.git', 'hooks');
  cpSync(path.join(repo, 'examples', 'git-hooks-enforcement', 'hooks', 'pre-commit'), path.join(hooksDir, 'pre-commit'));
  cpSync(path.join(repo, 'examples', 'git-hooks-enforcement', 'hooks', 'post-commit'), path.join(hooksDir, 'post-commit'));
  chmodSync(path.join(hooksDir, 'pre-commit'), 0o755);
  chmodSync(path.join(hooksDir, 'post-commit'), 0o755);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-git-hooks-'));
try {
  const repo = path.join(tempRoot, 'host');
  mkdirSync(repo, { recursive: true });
  copyRuntime(root, repo);
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(repo, ['config', 'user.name', 'ATM Hook Validator']);

  const bootstrap = run(process.execPath, ['atm.mjs', 'bootstrap', '--cwd', repo, '--json'], repo);
  const bootstrapPayload = JSON.parse((bootstrap.stdout || bootstrap.stderr || '').trim());
  assert(bootstrapPayload.ok === true, 'bootstrap must report ok=true');
  installHooks(repo);

  runGit(repo, ['add', '.']);
  const governedCommit = runGit(repo, ['commit', '-m', 'governed bootstrap']);
  assert(governedCommit.status === 0, 'governed commit must succeed with hooks installed');
  assert(existsSync(path.join(repo, '.atm', 'history', 'evidence', 'git-head.json')), 'pre-commit hook must write git-head evidence');
  const governedDoctor = runDoctor(repo);
  assert(governedDoctor.exitCode === 0, 'doctor must pass after governed commit');
  assert(governedDoctor.parsed.ok === true, 'doctor must report ok=true after governed commit');

  writeFileSync(path.join(repo, 'bypass.txt'), 'commit without ATM evidence\n', 'utf8');
  runGit(repo, ['add', 'bypass.txt']);
  const noHooksDir = path.join(tempRoot, 'no-hooks');
  mkdirSync(noHooksDir, { recursive: true });
  runGit(repo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'bypass hooks']);

  const bypassDoctor = runDoctor(repo);
  assert(bypassDoctor.exitCode === 1, 'doctor must fail after bypass commit');
  assert(bypassDoctor.parsed.ok === false, 'doctor must report ok=false after bypass commit');
  assert(bypassDoctor.parsed.messages.some((entry: any) => entry.code === 'ATM_DOCTOR_GIT_EVIDENCE_MISSING'), 'doctor must emit ATM_DOCTOR_GIT_EVIDENCE_MISSING after bypass commit');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[git-hooks-enforcement:${mode}] ok (hook example verified)`);
}
