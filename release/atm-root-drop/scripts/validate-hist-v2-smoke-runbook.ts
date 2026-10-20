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
// throwaway shared clone of HEAD whose pinned core paths are restored to that
// merge. It is a separate repository (not a linked worktree of this one), it is
// deleted afterwards, and the runbook bytes, the harness and the prereg are not
// touched; a real smoke run still needs a checkout that satisfies the pins.
const pins = JSON.parse(readFileSync(path.join(runbook, 'pins.json'), 'utf8')) as { core_merge_sha: string; core_paths: string[] };
const pinnedRoot = path.join(mkdtempSync(path.join(tmpdir(), 'hist-v2-smoke-pinned-')), 'repo');
function git(cwd: string, args: string[]): void {
  const done = spawnSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
  if ((done.status ?? 1) !== 0) {
    console.error(`git ${args.join(' ')} failed in ${cwd}`);
    process.exit(done.status ?? 1);
  }
}
const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
let status = 1;
try {
  // --shared borrows this repository's object store, so detached CI heads and
  // the pinned merge resolve without fetching.
  // CI checks out with --filter=blob:none, so the pinned blobs may not be local
  // yet and the clone cannot fetch them lazily. A content diff in this
  // repository batch-fetches both sides of the pinned paths first.
  git(root, ['-c', 'core.pager=cat', 'diff', '--no-ext-diff', '--no-textconv', '--binary', '--output=/dev/null', pins.core_merge_sha, headSha, '--', ...pins.core_paths]);
  git(root, ['clone', '--quiet', '--shared', '--no-checkout', root, pinnedRoot]);
  git(pinnedRoot, ['checkout', '--quiet', '--detach', headSha]);
  // Drop the pinned paths first: checkout <pin> -- <paths> restores files but
  // keeps ones added after the pin, which the runbook would still see as a diff.
  git(pinnedRoot, ['rm', '-r', '-q', '--ignore-unmatch', '--', ...pins.core_paths]);
  git(pinnedRoot, ['checkout', pins.core_merge_sha, '--', ...pins.core_paths]);
  git(pinnedRoot, ['-c', 'user.name=hist-v2-smoke-validator', '-c', 'user.email=hist-v2-smoke-validator@atm.local', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', 'validator: pinned core paths']);
  status = runTests(pinnedRoot);
} finally {
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
