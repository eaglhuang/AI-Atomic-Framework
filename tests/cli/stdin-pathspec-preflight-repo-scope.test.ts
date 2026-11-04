import assert from 'node:assert/strict';
import path from 'node:path';
import { inspectStdinPathspecGitAddProcesses } from '../../packages/cli/src/commands/git-governance/implementation/git-process-port.ts';

// A stuck stdin pathspec helper only hangs commits in its own repository.
// The preflight used to count every such git process on the host, so a
// helper in an unrelated repository failed this one's commit.
const helper = 'git add -A -f --pathspec-from-file=- --pathspec-file-nul';
const repo = path.resolve('/work/shop');

function inspect(processes: readonly Record<string, unknown>[], cwd?: string) {
  process.env.ATM_GIT_STDIN_PATHSPEC_PROCESS_FIXTURE = JSON.stringify(processes);
  try {
    return inspectStdinPathspecGitAddProcesses(cwd);
  } finally {
    delete process.env.ATM_GIT_STDIN_PATHSPEC_PROCESS_FIXTURE;
  }
}

assert.equal(inspect([{ pid: 1, commandLine: helper, cwd: path.resolve('/work/other') }], repo).length, 0, 'a helper in another repository is ignored');
assert.equal(inspect([{ pid: 2, commandLine: helper, cwd: repo }], repo).length, 1, 'a helper in this repository counts');
assert.equal(inspect([{ pid: 3, commandLine: helper, cwd: repo }], path.join(repo, 'src')).length, 1, 'a helper at the root counts for a nested commit cwd');
assert.equal(inspect([{ pid: 4, commandLine: helper }], repo).length, 1, 'a helper with unknown cwd still counts');
assert.equal(inspect([{ pid: 5, commandLine: helper, cwd: path.resolve('/work/other') }]).length, 1, 'without a repository cwd every helper counts');

console.log('ok: stdin pathspec preflight is scoped to the repository');
