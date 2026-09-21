import assert from 'node:assert/strict';
import { buildHostGitCompatibilityGuidance } from './git-index-transaction.ts';

const guidance = buildHostGitCompatibilityGuidance({
  gitExecutable: 'git',
  copyableCommitCommand: 'git commit -m "repair"',
  stderr: 'spawnSync git ENAMETOOLONG',
  stdout: ''
});

for (const variable of [
  'ATM_COMMIT_ACTOR_ID',
  'ATM_COMMIT_TASK_ID',
  'ATM_COMMIT_CLAIM_ID',
  'ATM_COMMIT_SESSION_ID',
  'ATM_COMMIT_LANE_SESSION_ID'
]) {
  assert.match(guidance, new RegExp(variable));
}
assert.match(guidance, /ATM_TASK_ID is not a substitute/);

const ordinary = buildHostGitCompatibilityGuidance({
  gitExecutable: 'git',
  copyableCommitCommand: 'git commit -m "repair"',
  stderr: 'fatal: trailer format rejected',
  stdout: ''
});
assert.doesNotMatch(ordinary, /Windows pathspec fallback/);

console.log('[git-host-compatibility-guidance] ok');
