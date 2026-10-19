// Runs the HIST-v2 smoke runbook unit tests. It does not start a benchmark.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runbook = path.join(root, 'research/paper-v2/benchmark-design/hist-v2-smoke-runbook');
const harnessSrc = path.join(root, 'research/paper-v2/benchmark-harness/hist-v2-harness-v2/src');
const classifierSrc = path.join(root, 'research/paper-v2/benchmark-design/hist-v2-classifier-v8/src');
const pyTarget = mkdtempSync(path.join(tmpdir(), 'hist-v2-smoke-py-'));
const install = spawnSync(
  'python3',
  ['-m', 'pip', 'install', '--disable-pip-version-check', '--target', pyTarget, '-r', path.join(runbook, 'requirements.txt')],
  { stdio: 'inherit' }
);
if ((install.status ?? 1) !== 0) {
  process.exit(install.status ?? 1);
}

// The sealed runbook refuses to run unless its pinned core paths equal the
// pinned core merge. main keeps evolving the broker, so the tests run against a
// throwaway detached worktree of HEAD whose pinned core paths are restored to
// that merge. The runbook bytes, the harness and the prereg are not touched;
// a real smoke run still needs a checkout that satisfies the pins by itself.
const pins = JSON.parse(readFileSync(path.join(runbook, 'pins.json'), 'utf8')) as { core_merge_sha: string; core_paths: string[] };
const pinnedRoot = path.join(mkdtempSync(path.join(tmpdir(), 'hist-v2-smoke-pinned-')), 'repo');
function git(cwd: string, args: string[]): void {
  const done = spawnSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
  if ((done.status ?? 1) !== 0) {
    console.error(`git ${args.join(' ')} failed in ${cwd}`);
    process.exit(done.status ?? 1);
  }
}
git(root, ['worktree', 'add', '--detach', '--quiet', pinnedRoot, 'HEAD']);
let status = 1;
try {
  git(pinnedRoot, ['checkout', pins.core_merge_sha, '--', ...pins.core_paths]);
  git(pinnedRoot, ['-c', 'user.name=hist-v2-smoke-validator', '-c', 'user.email=hist-v2-smoke-validator@atm.local', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', 'validator: pinned core paths']);
  status = runTests(pinnedRoot);
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', pinnedRoot], { cwd: root, stdio: 'ignore' });
  rmSync(path.dirname(pinnedRoot), { recursive: true, force: true });
}
if (status !== 0) {
  process.exit(status);
}

console.log('ok: validate-hist-v2-smoke-runbook');

function runTests(repoRoot: string): number {
  const env = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    HIST_V2_REPO_ROOT: repoRoot,
    HIST_V2_PYTHONPATH: pyTarget,
    PYTHONPATH: [path.join(runbook, 'src'), harnessSrc, classifierSrc, pyTarget].join(path.delimiter)
  };
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(runbook, 'tests'), '-v'], {
    cwd: runbook,
    env,
    stdio: 'inherit'
  });
  return result.status ?? 1;
}
