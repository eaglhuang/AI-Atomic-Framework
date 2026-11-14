export const defaultOnefileRunnerPath = 'release/atm-onefile/atm.mjs';

export const forbiddenAdopterScratchPaths = Object.freeze([
  'scratch/atm-build-repo',
  'scratch/atm-upstream-patch'
]);

// Target health checks run with the previous runner and again with the new one.
// A sync fails only when a check that passed before fails afterwards, so
// pre-existing target problems never block a runner upgrade.
export const targetVerificationCommands: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['doctor', '--json']),
  Object.freeze(['framework-mode', 'status', '--json']),
  Object.freeze(['tasks', 'audit', '--json'])
]);

// Files a runner sync writes and may commit in the target repository.
export const targetRunnerSyncPaths: readonly string[] = Object.freeze(['atm.mjs', '.atm/runtime/pinned-runner.json']);
