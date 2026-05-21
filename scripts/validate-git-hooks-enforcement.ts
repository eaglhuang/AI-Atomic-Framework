import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string): never {
  console.error(`[git-hooks-enforcement:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    fail(message);
  }
}

function run(command: string, args: readonly string[], cwd: string, options: { allowFailure?: boolean } = {}) {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8'
  });
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    fail(`${command} ${args.join(' ')} failed\nerror:\n${result.error?.message || ''}\nstdout:\n${result.stdout || ''}\nstderr:\n${result.stderr || ''}`);
  }
  return result;
}

function runGit(repo: string, args: readonly string[], options: { allowFailure?: boolean } = {}) {
  return run('git', args, repo, options);
}

function runCli(repo: string, args: readonly string[], options: { allowFailure?: boolean } = {}) {
  return run(process.execPath, ['atm.mjs', ...args], repo, options);
}

function parsePayload(result: ReturnType<typeof run>) {
  const payload = (result.stdout || result.stderr || '').trim();
  return payload ? JSON.parse(payload) : {};
}

function copyRuntime(sourceRoot: string, targetRoot: string) {
  for (const entry of ['atm.mjs', 'atomic-registry.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'eslint.config.mjs', 'docs', 'packages', 'scripts', 'schemas', 'specs', 'templates', 'examples']) {
    const sourcePath = path.join(sourceRoot, entry);
    if (!existsSync(sourcePath)) continue;
    cpSync(sourcePath, path.join(targetRoot, entry), { recursive: true });
  }
}

const preCommitTemplate = readFileSync(path.join(root, 'templates', 'enforcement', 'pre-commit.sh'), 'utf8');
assert(preCommitTemplate.includes('node atm.mjs atm-chart verify --json'), 'pre-commit enforcement template must verify ATMChart freshness');
assert(preCommitTemplate.includes('node atm.mjs hook pre-commit --json'), 'pre-commit enforcement template must delegate to ATM hook pre-commit');
assert(preCommitTemplate.includes('node atm.mjs tasks audit --json'), 'pre-commit enforcement template must audit task closure integrity');
assert(preCommitTemplate.includes('node atm.mjs agent-pack verify-fresh --id "$pack_id" --json'), 'pre-commit enforcement template must verify installed agent-pack freshness');

const examplePreCommit = readFileSync(path.join(root, 'examples', 'git-hooks-enforcement', 'hooks', 'pre-commit'), 'utf8');
assert(examplePreCommit.includes('node atm.mjs hook pre-commit --json'), 'example pre-commit hook must use hook pre-commit command');

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-git-hooks-'));
try {
  const repo = path.join(tempRoot, 'host');
  mkdirSync(repo, { recursive: true });
  copyRuntime(root, repo);
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'atm@example.invalid']);
  runGit(repo, ['config', 'user.name', 'ATM Hook Validator']);

  const bootstrapPayload = parsePayload(runCli(repo, ['bootstrap', '--cwd', repo, '--json']));
  assert(bootstrapPayload.ok === true, 'bootstrap must report ok=true');

  const atmChartPayload = parsePayload(runCli(repo, ['atm-chart', 'render', '--cwd', repo, '--json']));
  assert(atmChartPayload.ok === true, 'atm-chart render must report ok=true');

  const welcomePayload = parsePayload(runCli(repo, ['welcome', '--cwd', repo, '--json']));
  assert(welcomePayload.ok === true, 'welcome must report ok=true');

  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '--no-verify', '-m', 'initial baseline']);

  const installPayload = parsePayload(runCli(repo, ['integration', 'add', 'claude-code', '--force', '--json']));
  assert(installPayload.ok === true, 'integration add claude-code must report ok=true');
  const hookVerifyPayload = parsePayload(runCli(repo, ['integration', 'hooks', 'verify', 'claude-code', '--json']));
  assert(hookVerifyPayload.ok === true, 'integration hooks verify claude-code must report ok=true');
  assert(existsSync(path.join(repo, '.atm', 'git-hooks', 'pre-commit')), 'git-hooks install must write .atm/git-hooks/pre-commit');
  assert(existsSync(path.join(repo, '.atm', 'git-hooks', 'pre-push')), 'git-hooks install must write .atm/git-hooks/pre-push');

  writeFileSync(path.join(repo, 'docs-only.txt'), 'governed commit\n', 'utf8');
  runGit(repo, ['add', 'docs-only.txt']);
  const governedCommit = runGit(repo, ['commit', '-m', 'governed docs change']);
  assert(governedCommit.status === 0, 'governed commit must succeed with hooks installed');
  assert(existsSync(path.join(repo, '.atm', 'history', 'evidence', 'git-head.json')), 'pre-commit hook must write git-head evidence');

  const governedDoctor = parsePayload(runCli(repo, ['doctor', '--json']));
  assert(governedDoctor.ok === true, 'doctor must report ok=true after governed commit');

  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const bypass = true;\n', 'utf8');
  runGit(repo, ['add', 'packages/core/src/index.ts']);
  const noHooksDir = path.join(tempRoot, 'no-hooks');
  mkdirSync(noHooksDir, { recursive: true });
  runGit(repo, ['-c', `core.hooksPath=${noHooksDir}`, 'commit', '-m', 'bypass hooks']);

  const bypassDoctor = runCli(repo, ['doctor', '--json'], { allowFailure: true });
  const bypassDoctorPayload = parsePayload(bypassDoctor);
  assert(bypassDoctor.status === 1, 'doctor must fail after bypass commit');
  assert(bypassDoctorPayload.ok === false, 'doctor must report ok=false after bypass commit');
  assert(bypassDoctorPayload.messages.some((entry: any) => entry.code === 'ATM_DOCTOR_GIT_EVIDENCE_MISSING'), 'doctor must emit ATM_DOCTOR_GIT_EVIDENCE_MISSING after bypass commit');

  const commitRange = runCli(repo, ['guard', 'commit-range', '--base', 'HEAD~1', '--head', 'HEAD', '--json'], { allowFailure: true });
  const commitRangePayload = parsePayload(commitRange);
  assert(commitRange.status === 1, 'commit-range guard must fail for critical bypass commit');
  assert(commitRangePayload.messages.some((entry: any) => entry.code === 'ATM_GUARD_COMMIT_RANGE_FAILED'), 'commit-range guard must emit ATM_GUARD_COMMIT_RANGE_FAILED');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[git-hooks-enforcement:${mode}] ok (ATM hook command, Git hook install, and commit-range bypass detection verified)`);
}
